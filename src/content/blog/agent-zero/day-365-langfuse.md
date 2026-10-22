---
title: 'Day 365 · Tracing(二):半小时接入 Langfuse'
description: '昨天手写的 span 记录器只能在终端里打印。今天换成 Langfuse:先算清楚云版免费档和自托管各要什么,再给工单 Agent 加一行 import、两处 observe,把评测结果作为 score 写回 trace。没有账号也能学:用标准库写一个假的 Langfuse 收件箱,接住 SDK 真正发出去的数据,看清楚它到底发了什么。'
pubDate: 2026-10-22
regime: none
tags: ['observability', 'tracing', 'langfuse', 'agent-zero']
series: 'agent-zero'
day: 365
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 把 trace 和 span 讲清楚了:span 是一步,有编号、父编号、名字、开始结束时间和属性;trace 是同一个 trace_id 下所有 span 连成的树。我们用上下文管理器加一个栈,二十几行写了 `part06/mini_trace.py`,套在工单 Agent 上画出瀑布图,看出时间几乎全花在调模型上,还从 trace 里切出了轨迹。

手写的记录器有两个问题。一是每个地方都要自己写 `with tracer.span(...)`,还要自己往属性里塞 token;二是数据只存在你电脑上的 JSON 里,同事看不到,也没有界面可以点、可以筛。今天换成一个真正的工具 Langfuse,它把这两件事都包了。昨天那张三家叫法的对齐表,今天会在它的数据里一行行见到。

## 今天要解决的问题

学完今天你应该能:

1. 说清楚 Langfuse 云版和自托管各自要付出什么(钱、机器、数据去哪),给自己的场景选一个。
2. 用 `@observe`、`propagate_attributes` 和 `langfuse.openai` 给工单 Agent 接上 Langfuse,知道每一行让 SDK 多记了什么。
3. 用 `create_score` 把 Day 360、361 的评测结果写回对应的 trace,点开一个 trace 就能同时看到步骤和分数。
4. 没有账号时,能用一个本地假收件箱接住 SDK 发出的数据,自己验证接入对不对。

今天两个新概念:**云版和自托管的取舍**,和 **Langfuse SDK 的接入方式**(observe、propagate_attributes、score)。假收件箱只是工具,用到的都是 [Day 78](/blog/agent-zero/day-078-server-2/) 学过的 `http.server`。

预计用时 2.5 小时。实跑调了 5 次 Agent(单跑 1 张、带评分 3 张、练习 1 一张),合计输入约 1.6 万、输出约 2500 个 token,按 deepseek-flash 高峰价算约 0.05 元,算式在第四步末尾。前置:[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 的 `part06/mini_trace.py`(`print_tree` 今天还要用);[Day 360](/blog/agent-zero/day-360-trajectory-1/) 的 `part06/traj_agent.py` 和 `part06/outcome_check.py`;[Day 361](/blog/agent-zero/day-361-trajectory-2/) 的 `part06/trajectory.py`;[Day 96](/blog/agent-zero/day-096-decorators/) 的装饰器;[Day 78](/blog/agent-zero/day-078-server-2/) 的 `BaseHTTPRequestHandler`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `lf_agent.py` 里加的那几行默写出来,说清楚每一行让 trace 里多了什么;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

**关于没实跑的部分,先说清楚**:我写这一课时没有 Langfuse 账号,真正的 Langfuse 网页界面我没有打开过。下面所有终端输出都是真实跑出来的,SDK 也是真的把数据发了出去,只是收数据的是我们自己写的假收件箱。第五步「换成真的云版」是照着官方文档写的步骤,没实跑,文中会再标一次。

## 先选:云版还是自托管

Langfuse 是一个开源的 LLM 可观测平台:你的代码通过它的 SDK 把 trace 发过去,它存起来,给你一个网页看树、筛选、算钱、打分。它本身是开源的,所以有两种用法:用官方托管的云版,或者自己部署一套(自托管,self-hosting)。

先看自托管要什么。官方文档列的组件有六样:Web(界面和 API)、Worker(后台异步处理)、PostgreSQL(存项目、用户这类业务数据)、ClickHouse(存 trace 这类海量观测数据)、Redis 或 Valkey(缓存和队列)、S3 或兼容的对象存储(存原始事件和附件)。用 docker compose 一键拉起来是最省事的,但文档同时写了两句:compose 这套「没有高可用、扩展能力和备份」,建议的虚拟机配置是**至少 4 核、16 GiB 内存**,还要约 100 GiB 磁盘。

拿这个对一下我们的机器。这门课默认的环境是一台 2019 款 Intel MacBook Pro,没有 Docker;就算有,16 GiB 内存全给 Langfuse,浏览器和编辑器就没地方待了。学习阶段自托管不现实,等到 [Day 423](/blog/agent-zero/day-423-compose-prod/) 部署整个系统时,我们会在服务器上用 compose 把它和应用一起拉起来。

再看云版。2026 年 10 月在 [Langfuse 定价页](https://langfuse.com/pricing) 查到的免费档叫 Hobby:每月 5 万个 unit、数据能看 30 天、最多 2 个用户。unit 是计费单位,文档的说法是「发到平台的每一个 tracing 数据点」,包括 trace、observation(span、event、generation)和 score,一个算一个。付费的 Core 档每月 29 美元,含 10 万 unit,超出部分每 10 万 unit 8 美元。云版目前有欧盟、美国、日本、HIPAA 四个区域,域名不同。

一张工单要花几个 unit,练习 4 会用今天的真实数据算出来:平均 13 个左右,免费档一个月够三千多张。学习完全够用。

那什么时候必须自托管?看数据。客服 trace 里有客户姓名、手机号、发票,云版的四个区域都在境外。数据能不能出境不是技术问题,是合规问题,[Day 367](/blog/agent-zero/day-367-tracing-views/) 会专门讲。简单的判断:

| | 云版(Hobby 免费档) | 自托管(docker compose) |
| --- | --- | --- |
| 钱 | 每月 5 万 unit 免费,超了要升级 | 软件免费,机器和运维自己出 |
| 机器 | 不用 | 至少 4 核 16 GiB,六个组件 |
| 数据在哪 | 欧盟/美国/日本的 Langfuse 服务器 | 你自己的服务器 |
| 上手 | 注册拿两个 key,几分钟 | 半天起步,要会 Docker |
| 谁来升级、备份 | Langfuse | 你 |
| 适合 | 个人学习、数据可以出境的团队 | 数据不能出境、要进公司内网 |

我的建议:学习用云版;做公司项目,先问清楚数据能不能出境,不能就自托管,而且一开始就让懂运维的同事参与,别自己闷头在一台小机器上跑 ClickHouse。

## Langfuse 的 SDK 做了什么

在动手之前,先看一眼数据是怎么走的。Langfuse 的 Python SDK 从 v3 起就建在 OpenTelemetry 之上:你在代码里打的每一个 observation,其实都是一个 OpenTelemetry 的 span,SDK 在后台攒一批,压缩以后发给 Langfuse 的一个接口。分数(score)走另一个接口,是普通的 JSON。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Langfuse SDK 的数据流:Agent 代码里的 observe、langfuse.openai、propagate_attributes 产生 span,后台攒批后发到两个接口,接收方可以是云版、自托管或今天的假收件箱">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="200" height="150" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="42" fill="var(--ink)">你的 Agent 进程</text>
<text x="28" y="68" fill="var(--ink-soft)">@observe → agent/tool</text>
<text x="28" y="90" fill="var(--ink-soft)">langfuse.openai</text>
<text x="40" y="108" fill="var(--ink-soft)">→ generation</text>
<text x="28" y="130" fill="var(--ink-soft)">propagate_attributes</text>
<text x="40" y="148" fill="var(--ink-soft)">→ user.id session.id</text>
<rect x="246" y="60" width="130" height="70" fill="none" stroke="var(--rule)"/>
<text x="258" y="84" fill="var(--ink)">后台攒一批</text>
<text x="258" y="104" fill="var(--ink-soft)">约 5 秒或</text>
<text x="258" y="120" fill="var(--ink-soft)">flush()</text>
<line x1="216" y1="95" x2="246" y2="95" stroke="var(--ink-soft)"/>
<line x1="376" y1="80" x2="420" y2="50" stroke="var(--ink-soft)"/>
<line x1="376" y1="110" x2="420" y2="140" stroke="var(--ink-soft)"/>
<text x="424" y="40" fill="var(--ink)">POST /api/public/otel/v1/traces</text>
<text x="424" y="58" fill="var(--ink-faint)">protobuf + gzip</text>
<text x="424" y="140" fill="var(--ink)">POST /api/public/scores</text>
<text x="424" y="158" fill="var(--ink-faint)">JSON</text>
<rect x="16" y="200" width="608" height="80" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="222" fill="var(--ink)">接收方(只改 LANGFUSE_BASE_URL 这一个环境变量)</text>
<text x="28" y="246" fill="var(--ink-soft)">云版 https://cloud.langfuse.com   自托管 http://你的服务器:3000</text>
<text x="28" y="266" fill="var(--ink-soft)">今天的假收件箱 http://127.0.0.1:3999 → part06/inbox/*.jsonl</text>
<line x1="500" y1="165" x2="500" y2="200" stroke="var(--ink-soft)"/>
</g>
</svg>
<figcaption>SDK 那一侧完全一样,接收方是谁只由 LANGFUSE_BASE_URL 决定。所以今天用假收件箱学到的接入代码,换成云版时一行不用改。</figcaption>
</figure>

图里那两个接口地址,是我从 SDK 源码里找出来、又被下面的假收件箱实测接到的。这件事给了我们一个学习的办法:既然接收方只是一个 HTTP 服务,我们自己写一个接住它,就能在没有账号的情况下看清楚 SDK 到底发了什么。这和前端开发时用 MSW 之类的工具 mock 一个后端接口是同一个思路。

## 第零步:装 SDK,先看看没配 key 会怎样

在 `agent-zero-lab` 根目录(这一课里所有命令都在这里跑,比如 `/Users/你/agent-zero-lab`)装上 SDK:

```bash
uv add langfuse
```

2026 年 10 月装到的是 `langfuse 5.0.4`,它会顺带装上 `opentelemetry-sdk 1.45.1`、`opentelemetry-exporter-otlp-proto-http 1.45.1` 和 `protobuf`,后面的假收件箱和 Day 366 都会用到它们。

先写一个最小的例子:两个普通函数,外层是「处理工单」,里面调一个假的「查订阅」工具。不调模型,不花钱。

```python
# agent-zero-lab/part06/lf_hello.py
"""Langfuse 的最小例子:两个普通函数套上 @observe,看 SDK 记下什么。不调模型。
用法: uv run python -m part06.lf_hello"""
from __future__ import annotations

import time

from dotenv import load_dotenv

load_dotenv()

from langfuse import get_client, observe, propagate_attributes  # noqa: E402

langfuse = get_client()


@observe(as_type="tool")
def get_subscription(customer_id: str) -> dict:
    time.sleep(0.05)
    return {"plan": "专业版", "billing_cycle": "yearly", "seats": 5}


@observe(name="handle_ticket")
def handle_ticket(customer_id: str, ticket: str) -> str:
    with propagate_attributes(user_id=customer_id, session_id="hello-1", tags=["day365"]):
        sub = get_subscription(customer_id)
        print("trace_id:", langfuse.get_current_trace_id())
        return f"您是{sub['plan']},{sub['seats']} 个席位"


if __name__ == "__main__":
    print(handle_ticket("C007", "我是什么套餐?"))
    langfuse.flush()
```

<div class="line-notes">

- `load_dotenv()` 把 `.env` 里的变量读进环境变量。必须在 `get_client()` 之前,因为客户端是在创建那一刻读 `LANGFUSE_PUBLIC_KEY` 这些变量的,晚了就读不到。
- `from langfuse import get_client, observe, propagate_attributes  # noqa: E402` 行尾的 `# noqa: E402` 告诉代码检查工具「import 不在文件最上面是故意的」,因为要先跑完 `load_dotenv()`。`E402` 是 Ruff/flake8 的规则编号。
- `langfuse = get_client()` 拿到进程里唯一的 Langfuse 客户端。「唯一」是说同一个进程里不管在哪个文件调 `get_client()`,拿到的都是同一个对象,这种写法叫单例(singleton)。相当于前端项目里在一个模块里 `export const client = createClient()`,其他地方都 import 它。
- `@observe(as_type="tool")` 装饰器([Day 96](/blog/agent-zero/day-096-decorators/))。被它装饰的函数每调用一次,就产生一个 observation,函数的参数记成输入、返回值记成输出,开始结束时间自动记。`as_type="tool"` 说明这是一次工具调用,Langfuse 界面上会用工具的图标显示。
- `@observe(name="handle_ticket")` 不写 `as_type` 就是普通的 span。`name` 不写的话默认用函数名,这里写出来只是为了看得清楚。
- `with propagate_attributes(user_id=customer_id, session_id="hello-1", tags=["day365"]):` 给「当前这个 observation 和它里面新开的所有 observation」都挂上用户、会话和标签。代入后是 `user_id="C007"`。Day 364 练习 3 我们自己往根 span 上挂过 `session.id`、`user.id`,这里是 SDK 帮你挂,而且每个孩子都挂一份。
- `print("trace_id:", langfuse.get_current_trace_id())` 取当前 trace 的编号。要在被 `@observe` 包着的函数里面调才有值,外面调是 None。
- `langfuse.flush()` 让后台把还没发出去的数据立刻发完。练习 3 会实测不写它会怎样。

</div>

`.env` 里还没有任何 Langfuse 的配置,先这样跑一次:

```bash
uv run python -m part06.lf_hello
```

实测输出:

```text
Authentication error: Langfuse client initialized without public_key. Client will be disabled. Provide a public_key parameter or set LANGFUSE_PUBLIC_KEY environment variable. 
Authentication error: Langfuse client initialized without public_key. Client will be disabled. Provide a public_key parameter or set LANGFUSE_PUBLIC_KEY environment variable. 
Authentication error: Langfuse client initialized without public_key. Client will be disabled. Provide a public_key parameter or set LANGFUSE_PUBLIC_KEY environment variable. 
Context error: No active span in current context. Operations that depend on an active span will be skipped. Ensure spans are created with start_as_current_observation() or that you're operating within an active span context.
trace_id: None
您是专业版,5 个席位
```

注意最后一行:函数照样返回了正确的结果,程序也没有崩。没配 key 时 SDK 只打几行警告,然后把自己变成「什么都不做」的空壳(Client will be disabled),`trace_id` 是 None。这是故意的设计,观测工具不能因为自己配错了就把业务搞挂。代价是你很容易没发现它根本没在工作:日志一多,这几行警告就被淹了。**接入以后第一件事,确认 trace_id 不是 None**。

## 第一步:没有账号?先起一个假收件箱

真实情况下,这时你会去注册云版、拿两个 key。我们先不注册,自己写一个假的 Langfuse。它只做三件事:接住 `POST /api/public/otel/v1/traces` 发来的 span,把 protobuf 解出来,翻译成 Day 364 那种 span 字典存进 `part06/inbox/spans.jsonl`;接住 `POST /api/public/scores` 发来的分数,原样存进 `scores.jsonl`;`GET /api/public/projects` 时回一个假项目(SDK 拼 trace 网页链接时要查项目编号)。

protobuf 是 Google 定的一种二进制数据格式,比 JSON 小、解析快,但人眼看不懂,得用对应的「格式说明」解开。OpenTelemetry 的 span 格式说明打包在 `opentelemetry-proto` 里,装 langfuse 时已经顺带装上了。

```python
# agent-zero-lab/part06/fake_langfuse.py
"""一个假的 Langfuse 收件箱:接住 SDK 发来的 trace 和 score,翻译成 Day 364 的 span 字典存进 part06/inbox/。
没有 Langfuse 账号也能看清 SDK 到底发了什么。用法: uv run python -m part06.fake_langfuse"""
from __future__ import annotations

import gzip
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue

INBOX = Path("part06/inbox")
PROJECT = {"data": [{"id": "fake-project", "name": "day365", "metadata": {},
                     "organization": {"id": "fake-org", "name": "local"}}]}


def value(v: AnyValue) -> object:
    kind = v.WhichOneof("value")
    if kind == "array_value":
        return [value(x) for x in v.array_value.values]
    return getattr(v, kind) if kind else None


def to_spans(body: bytes) -> list[dict]:
    req = ExportTraceServiceRequest()
    req.ParseFromString(body)
    out = []
    for rs in req.resource_spans:
        for ss in rs.scope_spans:
            for sp in ss.spans:
                out.append({"trace_id": sp.trace_id.hex(), "span_id": sp.span_id.hex(),
                            "parent_id": sp.parent_span_id.hex() or None, "name": sp.name,
                            "start": sp.start_time_unix_nano / 1e9, "end": sp.end_time_unix_nano / 1e9,
                            "attrs": {a.key: value(a.value) for a in sp.attributes}})
    return out


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        if self.path == "/api/public/otel/v1/traces":
            rows, file = to_spans(body), "spans.jsonl"
        elif self.path == "/api/public/scores":
            rows, file = json.loads(body), "scores.jsonl"
        else:
            rows, file = [], ""
        if file:
            with open(INBOX / file, "a", encoding="utf-8") as f:
                f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        print(f"POST {self.path}  收到 {len(rows)} 条", flush=True)
        self.reply({})

    def do_GET(self) -> None:
        self.reply(PROJECT if self.path == "/api/public/projects" else {})

    def reply(self, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    INBOX.mkdir(exist_ok=True)
    print("假 Langfuse 在 http://127.0.0.1:3999 等着,Ctrl+C 停", flush=True)
    HTTPServer(("127.0.0.1", 3999), Handler).serve_forever()
```

<div class="line-notes">

- `import gzip` 标准库,解压 gzip。为什么要它,看代码下面那个坑。
- `from http.server import BaseHTTPRequestHandler, HTTPServer` 就是 [Day 78](/blog/agent-zero/day-078-server-2/) 自己写工单服务时用的那两个类。
- `from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest` OpenTelemetry 规定的「一次上报 span 的请求」长什么样,由 protobuf 格式说明生成的 Python 类。路径很长,照抄即可。
- `from opentelemetry.proto.common.v1.common_pb2 import AnyValue` span 属性的值的类型。属性值可能是字符串、整数、布尔、小数或者数组,protobuf 用一个「多选一」的结构装它。
- `PROJECT = {"data": [{"id": "fake-project", "name": "day365", "metadata": {},` SDK 查项目时期望的形状。我第一次只回了 `{"id": ...}`,SDK 用 pydantic 校验时报了 `data.0.name Field required` 等 3 个错误,对着报错把 `name`、`organization`、`metadata` 补齐才过。
- `kind = v.WhichOneof("value")` 问这个 `AnyValue` 实际装的是哪一种,返回字段名字符串,比如 `"string_value"`、`"int_value"`、`"array_value"`。
- `return [value(x) for x in v.array_value.values]` 数组就把每个元素递归解开。实测 `tags=["day365"]` 解出来是 `['day365']`。
- `return getattr(v, kind) if kind else None` `getattr(对象, "属性名")` 用字符串取属性,相当于 JS 的 `v[kind]`。`kind` 是 `"string_value"` 就取 `v.string_value`。
- `req.ParseFromString(body)` 把二进制解析进这个对象。
- `for rs in req.resource_spans:` 一次上报按「哪个服务」(resource)分组,每组里再按「哪个埋点库」(scope)分组,最里面才是 span。三层循环就是一层层剥开。
- `out.append({"trace_id": sp.trace_id.hex(), "span_id": sp.span_id.hex(),` 编号在 protobuf 里是原始字节,`.hex()` 转成十六进制字符串,和 Day 364 记录器生成的格式一样:trace_id 32 个字符,span_id 16 个。
- `"parent_id": sp.parent_span_id.hex() or None, "name": sp.name,` 根 span 的父编号是空字节,`.hex()` 得到空字符串,`or None` 把它变成 None,和 Day 364 的约定一致。
- `"start": sp.start_time_unix_nano / 1e9, "end": sp.end_time_unix_nano / 1e9,` 时间在 OpenTelemetry 里是从 1970 年起的**纳秒**整数,除以 10 亿变成秒,和 Day 364 用的 `time.time()` 对齐。这样 Day 364 的 `print_tree` 能直接画它。
- `body = self.rfile.read(int(self.headers.get("Content-Length") or 0))` 按请求头里的字节数读请求体,Day 78 讲过 `Content-Length`。
- `if self.headers.get("Content-Encoding") == "gzip":` SDK 发 span 时把请求体用 gzip 压缩了,请求头里会写 `Content-Encoding: gzip`。
- `rows, file = json.loads(body), "scores.jsonl"` 分数是 JSON 数组,直接解析。
- `f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)` 一条一行地追加。这种「每行一个 JSON」的文件叫 JSONL,`part06/cases/` 里那些用例文件就是这个格式。
- `print(f"POST {self.path}  收到 {len(rows)} 条", flush=True)` `flush=True` 让这一行立刻写出去。服务跑在后台、输出重定向到文件时,不加它可能要等缓冲区满了才出现。
- `self.send_header("Content-Length", str(len(body)))` Day 78 的老规矩,按字节数算。
- `def log_message(self, format: str, *args: object) -> None:` 父类默认每个请求打一行访问日志,这里重写成什么都不做,让终端只剩我们自己的那一行。
- `HTTPServer(("127.0.0.1", 3999), Handler).serve_forever()` 只监听本机的 3999 端口。自托管 Langfuse 默认是 3000,我们错开,免得你以后真起了一个时撞上。

</div>

我第一版没写 gzip 那两行,收件箱这边每收到一次请求就报一次:

```text
google.protobuf.message.DecodeError: Error parsing message with type 'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest': Wire format was corrupt
```

SDK 那边则打出:

```text
Transient error ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response')) encountered while exporting spans batch, retrying in 1.00s.
Transient error ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response')) encountered while exporting spans batch, retrying in 1.95s.
Failed to export spans batch due to timeout, max retries or shutdown.
```

「Wire format was corrupt」的意思是「这串字节不像一个合法的 protobuf」。原因是请求体是压缩过的,直接拿去解析当然是乱码。SDK 一侧看到连接被断开,重试两次以后放弃,这批数据就丢了,而你的业务代码照样正常跑完,什么都没察觉。加上解压两行就好了。

开第二个终端窗口(同样在 `agent-zero-lab` 目录),起收件箱,让它一直开着:

```bash
uv run python -m part06.fake_langfuse
```

```text
假 Langfuse 在 http://127.0.0.1:3999 等着,Ctrl+C 停
```

回到第一个终端,在 `.env` 末尾加三行:

```bash
# agent-zero-lab/.env 追加(假收件箱用的,key 随便写,但不能空)
LANGFUSE_PUBLIC_KEY=pk-lf-local
LANGFUSE_SECRET_KEY=sk-lf-local
LANGFUSE_BASE_URL=http://127.0.0.1:3999
```

<div class="line-notes">

- `LANGFUSE_PUBLIC_KEY=pk-lf-local` 公钥,真实的以 `pk-lf-` 开头。假收件箱不检查它,但 SDK 发请求时会把公钥和私钥拼成 `pk-lf-local:sk-lf-local` 再做 base64 放进 `Authorization: Basic ...` 请求头,这两个假 key 编码出来就是 `Basic cGstbGYtbG9jYWw6c2stbGYtbG9jYWw=`(我先用一个只打印请求头的小服务抓过,格式就是这样)。这是 HTTP 最古老的 Basic 认证,base64 只是编码不是加密,所以真 key 绝不能走明文 http 发到公网。
- `LANGFUSE_BASE_URL=http://127.0.0.1:3999` 接收方地址。老教程里写的是 `LANGFUSE_HOST`,v4 起改叫 `LANGFUSE_BASE_URL`,新项目别再写旧名字。

</div>

## 第二步:看看 SDK 发了什么

再跑一次 `lf_hello.py`:

```bash
uv run python -m part06.lf_hello
```

```text
trace_id: d8c52ac15f69d532431e936f880411ea
您是专业版,5 个席位
```

这次有 trace_id 了。收件箱那个终端多了一行 `POST /api/public/otel/v1/traces  收到 2 条`。打开 `part06/inbox/spans.jsonl`,两行就是两个 span,其中「查订阅」那个长这样(实测原文,折了行):

```json
{"trace_id": "d8c52ac15f69d532431e936f880411ea", "span_id": "d2974c65a069d4d2", "parent_id": "e6131d5c0311e208",
 "name": "get_subscription", "start": 1792667544.701063, "end": 1792667544.751935,
 "attrs": {"user.id": "C007", "session.id": "hello-1", "langfuse.trace.tags": ["day365"],
           "langfuse.observation.input": "{\"args\": [\"C007\"], \"kwargs\": {}}",
           "langfuse.observation.type": "tool",
           "langfuse.observation.output": "{\"plan\": \"\\u4e13\\u4e1a\\u7248\", \"billing_cycle\": \"yearly\", \"seats\": 5}"}}
```

它的 `parent_id` 是 `e6131d5c…`,正是另一行 `handle_ticket` 的 `span_id`,而 `handle_ticket` 的 `parent_id` 是 null。

几处值得停下来看:

`user.id` 和 `session.id`,和 Day 364 我们手写时起的属性名一模一样,这不是巧合,它们是 OpenTelemetry 的通用属性名,Langfuse 直接沿用。`langfuse.observation.type` 是 `tool`,就是 `as_type="tool"`;Day 364 对齐表里说的「Langfuse 管 span 叫 observation,再分类型」,落到数据上就是这一个属性。`langfuse.observation.input` 是函数参数,**原样记下了**,包括客户编号。输出里的中文被转成了 `专` 这种转义,是 JSON 编码的默认行为,界面上显示时会还原。

一行一行读 JSON 太累。写一个小工具,把收件箱里最近几个 trace 用 Day 364 的 `print_tree` 画出来,顺便列出每个 observation 的类型和 token,以及挂在这个 trace 上的 score:

```python
# agent-zero-lab/part06/lf_view.py
"""在终端里看假收件箱:最近几个 trace 画成瀑布图,列出每个 observation 的类型和要点,再列出挂在上面的 score。
用法: uv run python -m part06.lf_view [最近几个 trace,默认 1]"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from part06.mini_trace import print_tree

INBOX = Path("part06/inbox")


def load(name: str) -> list[dict]:
    path = INBOX / name
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def by_trace(spans: list[dict]) -> dict[str, list[dict]]:
    traces: dict[str, list[dict]] = {}
    for s in spans:
        traces.setdefault(s["trace_id"], []).append(s)
    return dict(sorted(traces.items(), key=lambda kv: min(s["start"] for s in kv[1])))


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    scores = load("scores.jsonl")
    for tid, spans in list(by_trace(load("spans.jsonl")).items())[-n:]:
        root = next(s for s in spans if s["parent_id"] is None)
        print(f"\ntrace {tid[:8]}…  user={root['attrs'].get('user.id')}  session={root['attrs'].get('session.id')}")
        print_tree(spans)
        for s in sorted(spans, key=lambda x: x["start"]):
            a = s["attrs"]
            usage = json.loads(a.get("langfuse.observation.usage_details") or "{}")
            extra = f"  输入 {usage['prompt_tokens']} 输出 {usage['completion_tokens']}" if usage else ""
            print(f"  [{a.get('langfuse.observation.type')}] {s['name']}{extra}")
        for sc in scores:
            if sc.get("traceId") == tid:
                print(f"  score {sc['name']} = {sc['value']}  {sc.get('comment') or ''}")
```

<div class="line-notes">

- `from part06.mini_trace import print_tree` Day 364 写的瀑布图函数。收件箱存的就是同样形状的字典,所以直接能用。
- `if not path.exists():` 还没收到过分数时 `scores.jsonl` 不存在,返回空列表,不报错。
- `return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]` JSONL 文件一行一个 JSON,`splitlines()` 按行拆开再逐行解析。
- `traces.setdefault(s["trace_id"], []).append(s)` 按 trace_id 分组,Day 364 讲过 `setdefault`。
- `return dict(sorted(traces.items(), key=lambda kv: min(s["start"] for s in kv[1])))` 按每个 trace 最早的开始时间排序。`kv` 是 `(trace_id, span 列表)` 这样的二元组,`kv[1]` 是列表。排好后再转回字典,Python 3.7 起字典保留插入顺序,和 JS 的 Map 一样。
- `n = int(sys.argv[1]) if len(sys.argv) > 1 else 1` 命令行给了数字就看最近 n 个,不给就看最近 1 个。
- `for tid, spans in list(by_trace(load("spans.jsonl")).items())[-n:]:` 字典的 `.items()` 不能直接切片,先转成列表,`[-n:]` 取最后 n 个,和 JS 的 `.slice(-n)` 一样。
- `usage = json.loads(a.get("langfuse.observation.usage_details") or "{}")` 只有调模型的 generation 才有 token 用量,存的是 JSON 字符串,要再解析一次。没有就当空字典。
- `if sc.get("traceId") == tid:` 分数里的字段名是驼峰 `traceId`,因为它走的是 Langfuse 自己的 JSON 接口,不是 OpenTelemetry。

</div>

```bash
uv run python -m part06.lf_view
```

实测输出:

```text

trace d8c52ac1…  user=C007  session=hello-1
|████████████████████████████████████████| handle_ticket                      52 ms
|███████████████████████████████████████ |   get_subscription                 51 ms
  [span] handle_ticket
  [tool] get_subscription
```

和 Day 364 自己写的记录器画出来的一样,只是这次我们一行 `with` 都没写,两个装饰器就把父子关系、时间、输入输出都记下来了。它怎么知道 `get_subscription` 是 `handle_ticket` 的孩子?和我们的栈是一个道理:OpenTelemetry 维护着一个「当前 span」,`@observe` 进函数时把新 span 设成当前的,出函数时恢复。Day 366 会直接用这套底层接口。

## 第三步:工单 Agent 接上 Langfuse

现在给真正的工单 Agent 接上。和 Day 364 一样,不改 `traj_agent.py`,另写一个文件。要加的东西有四处:整个运行套一个 agent 类型的 observation,调模型自动记成 generation,每次调工具一个 tool 类型的 observation,用户和会话挂到整棵树上。

```python
# agent-zero-lab/part06/lf_agent.py
"""Day 360 的工单 Agent 接上 Langfuse:加一行 import 记下每次调模型,工具调用和整次运行各套一层 observation。
用法: uv run python -m part06.lf_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我" """
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from langfuse import get_client, observe, propagate_attributes  # noqa: E402
from langfuse import openai as _lf_openai  # noqa: E402, F401  导入就给进程里的 openai SDK 打上记录补丁

from part06.oracle import DB  # noqa: E402
from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client  # noqa: E402

langfuse = get_client()


@observe(name="invoke_agent ticket", as_type="agent")
def run(customer_id: str, ticket: str, session_id: str | None = None, max_turns: int = 10) -> dict:
    with propagate_attributes(user_id=customer_id, session_id=session_id, tags=["day365"]):
        tmp = Path(tempfile.mkdtemp()) / "cloudledger.db"
        shutil.copy(DB, tmp)
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        messages: list = [{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": f"[客户编号 {customer_id}] {ticket}"}]
        tool_calls: list[dict] = []
        tokens = {"in": 0, "out": 0}
        reply = ""
        for _ in range(max_turns):
            resp = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS,
                                                  temperature=0.7, extra_body=EXTRA,
                                                  name=f"chat {MODEL}")  # pyright: ignore[reportCallIssue]
            if resp.usage:
                tokens["in"] += resp.usage.prompt_tokens
                tokens["out"] += resp.usage.completion_tokens
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                reply = msg.content or ""
                break
            for tc in msg.tool_calls:
                if tc.type != "function":
                    continue
                args = json.loads(tc.function.arguments or "{}")
                with langfuse.start_as_current_observation(as_type="tool", name=f"execute_tool {tc.function.name}",
                                                           input=args) as obs:
                    result = call_tool(conn, tc.function.name, args)
                    obs.update(output=result)
                tool_calls.append({"name": tc.function.name, "args": args})
                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": json.dumps(result, ensure_ascii=False)})
        refunds = [dict(r) for r in conn.execute("SELECT invoice_id, amount_cents, reason FROM refund_requests")]
        conn.close()
        return {"customer_id": customer_id, "ticket": ticket, "tool_calls": tool_calls, "refunds": refunds,
                "reply": reply, "tokens": tokens, "trace_id": langfuse.get_current_trace_id()}


if __name__ == "__main__":
    result = run(sys.argv[1], sys.argv[2])
    print("trace_id:", result["trace_id"])
    print("工具:", [tc["name"] for tc in result["tool_calls"]], "token:", result["tokens"])
    print("回复:", result["reply"][:60])
    langfuse.flush()
```

<div class="line-notes">

- `from langfuse import openai as _lf_openai  # noqa: E402, F401  导入就给进程里的 openai SDK 打上记录补丁` 这一行是「调模型自动记录」的全部秘密。`langfuse.openai` 这个模块在被导入的那一刻,就把 `openai` SDK 里发请求的方法换成了一个「先记录再转发」的版本,这种做法叫猴子补丁(monkey patch),相当于在 JS 里把 `window.fetch` 换成一个包了一层的函数。导入后我们并不用 `_lf_openai` 这个名字,所以前面加下划线,`F401` 是「导入了但没用」的检查编号,告诉检查器这是故意的。
- `from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client  # noqa: E402` `client` 是 Day 360 在 `traj_agent.py` 里建好的那个 `OpenAI` 客户端。补丁打在类的方法上,所以早就建好的客户端也会被记录。官方文档的写法是 `from langfuse.openai import OpenAI` 再自己建一个客户端,效果一样;我用 basedpyright 检查时它报 `"OpenAI" is not exported from module "langfuse.openai"`,所以换成了现在这种。
- `@observe(name="invoke_agent ticket", as_type="agent")` 整次运行一个 agent 类型的 observation,名字照 Day 364 用的 GenAI 约定起。被装饰的 `run` 的参数(客户编号、工单原文)会被记成输入,返回的字典会被记成输出。
- `def run(customer_id: str, ticket: str, session_id: str | None = None, max_turns: int = 10) -> dict:` 比 Day 360 的 `run` 多一个 `session_id`,第四步会用它。返回的字典形状和 Day 360 一样,多一个 `trace_id`,这样 Day 360、361 的检查函数能直接吃它。
- `with propagate_attributes(user_id=customer_id, session_id=session_id, tags=["day365"]):` 文档特别强调要尽早调:在它之前就已经开始的 observation 不会被补上。放在函数第一行,保证下面所有调模型、调工具的 observation 都带上 `user.id`。`session_id` 是 None 时就不挂。
- `name=f"chat {MODEL}")  # pyright: ignore[reportCallIssue]` 打过补丁的 `create` 多认识一个 `name` 参数,用来给这个 generation 起名。不写的话默认叫 `OpenAI-generation`,我第一次试就是这个名字。这里起成 `chat deepseek-flash`,和 Day 364 一致。问题是类型检查器只认识 openai 原版的参数表,会报 `No overloads for "create" match the provided arguments`,所以在行尾告诉它这一行忽略这个检查。这是猴子补丁的通病:运行时多了东西,类型里没有。
- `with langfuse.start_as_current_observation(as_type="tool", name=f"execute_tool {tc.function.name}",` 工具调用用上下文管理器的写法,而不是给 `call_tool` 加 `@observe`。原因是 `call_tool(conn, name, args)` 的第一个参数是数据库连接,`@observe` 会把它也当成输入记下来,记成一串没意义的对象描述;而且所有工具会共用 `call_tool` 这一个名字。用 `start_as_current_observation`,名字和输入由我们自己定。
- `input=args) as obs:` 输入只记工具参数,实测是 `{"customer_id": "C007"}` 这种。
- `obs.update(output=result)` 工具跑完才知道结果,用 `update` 补上,和 Day 364 往 `s["attrs"]` 里补 token 是同一个思路。
- `"reply": reply, "tokens": tokens, "trace_id": langfuse.get_current_trace_id()}` 在 `@observe` 包着的函数里面取 trace_id,带回给调用方。第四步写分数要用它。
- `langfuse.flush()` 脚本马上退出,先把数据发完。

</div>

```bash
uv run python -m part06.lf_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我"
uv run python -m part06.lf_view
```

实测输出:

```text
trace_id: 22b7811dc00b1fd789906cdb8dae1007
工具: ['get_subscription', 'list_invoices', 'create_refund_request'] token: {'in': 3081, 'out': 488}
回复: 已为您提交退款申请，详情如下：

- **客户**：C007
- **退款发票**：INV-2026-0123（2026

trace 22b7811d…  user=C007  session=None
|████████████████████████████████████████| invoke_agent ticket              3719 ms
|█████████████                           |   chat deepseek-flash            1204 ms
|             █                          |   execute_tool get_subscription      3 ms
|             █                          |   execute_tool list_invoices        1 ms
|             █████████████              |   chat deepseek-flash            1235 ms
|                          █             |   execute_tool create_refund_request      2 ms
|                          █████████████ |   chat deepseek-flash            1264 ms
  [agent] invoke_agent ticket
  [generation] chat deepseek-flash  输入 669 输出 100
  [tool] execute_tool get_subscription
  [tool] execute_tool list_invoices
  [generation] chat deepseek-flash  输入 1088 输出 210
  [tool] execute_tool create_refund_request
  [generation] chat deepseek-flash  输入 1324 输出 178
```

和 Day 364 第二步的瀑布图对比一下:同样 7 个 span,同样的形状,第一次调模型的输入同样是 669 个 token。区别是这次每个节点都有了 Langfuse 认识的类型:agent、generation、tool,Day 364 对齐表里「Langfuse」那一列的词,全在这里了。

generation 上 SDK 自己记了什么?我把收件箱里第一个 generation 的属性名列出来(值很长,只列名字和要点):

| 属性 | 实测内容 |
| --- | --- |
| `langfuse.observation.type` | `generation` |
| `langfuse.observation.model.name` | `deepseek-flash` |
| `langfuse.observation.usage_details` | `{"completion_tokens": 100, "prompt_tokens": 669, "total_tokens": 769, ...}` |
| `langfuse.observation.model.parameters` | `{"temperature": 0.7, "max_tokens": "Infinity", ...}` |
| `langfuse.observation.input` | 整个请求:工具定义、system prompt、客户的话,约 2.7 KB |
| `langfuse.observation.output` | 模型的完整回复,包括它要调哪些工具 |
| `user.id` | `C007`(`propagate_attributes` 挂上的) |

两件事要记住。第一,**输入是完整的消息列表**,第三次调模型时,前面所有工具结果都在里面,实测第三个 generation 的输入有 5 KB 多。每个 generation 都存一遍,这就是 trace 数据会很大的原因,也是 Day 367 讲隐私时的重点:客户说的每一句话,在一个 trace 里会被存好几遍。第二,这里没有「花了多少钱」。真 Langfuse 会在服务端按模型名查单价算钱,但它的内置价格表不一定认识 `deepseek-flash`,不认识时费用一栏是空的,要在项目设置的 Models 页面自己加模型名和单价(这一步我没法实跑,是文档的说法)。

顺便说一句,SDK 还能拼出这个 trace 在网页上的链接:`langfuse.get_trace_url(trace_id=...)`。对着假收件箱实测返回的是 `http://127.0.0.1:3999/project/fake-project/traces/22b7811dc00b1fd789906cdb8dae1007`,换成云版就是能点开的地址。

## 第四步:把评测结果写回 trace

Day 360 到 363 我们做了一堆评测:`outcome_ok` 看库里的退款对不对,`trajectory_graders` 查顺序、越权、重复、退款参数、预算。结果都打印在终端里,和 trace 是分开的。现在把它们作为 score 写回对应的 trace,以后打开任何一个 trace,就能同时看到「它做了什么」和「它做得对不对」。

```python
# agent-zero-lab/part06/lf_scores.py
"""跑三张工单,把 Day 360 的结果评测和 Day 361 的轨迹检查作为 score 写回各自的 trace。
用法: uv run python -m part06.lf_scores"""
from __future__ import annotations

from part06.lf_agent import langfuse, run
from part06.outcome_check import outcome_ok
from part06.trajectory import trajectory_graders

CASES = [("C007", "10月8号扣了我两次,两笔都是2392,多扣的退我"),
         ("C023", "我们年付的,下个月起不用了,麻烦把剩下几个月的钱退给我们。"),
         ("C012", "你们扣了我两次钱!赶紧退!")]


def push_scores(trace_id: str, graders: dict[str, tuple[bool, str]], dataset: str) -> None:
    for name, (ok, why) in graders.items():
        langfuse.create_score(trace_id=trace_id, name=name, value=1 if ok else 0, data_type="BOOLEAN",
                              comment=why or None, metadata={"dataset": dataset})


if __name__ == "__main__":
    for cid, ticket in CASES:
        result = run(cid, ticket, session_id=f"day365-{cid}")
        graders = {"outcome": outcome_ok(result), **trajectory_graders(result)}
        push_scores(result["trace_id"], graders, dataset="day365-v1")
        fails = [k for k, (ok, _) in graders.items() if not ok]
        print(f"{cid}  trace {result['trace_id'][:8]}…  {len(graders)} 个 score  没过: {fails or '无'}")
    langfuse.flush()
```

<div class="line-notes">

- `from part06.lf_agent import langfuse, run` 导入 `lf_agent` 时它已经 `get_client()` 过了,这里直接拿同一个客户端。
- `CASES = [("C007", "10月8号扣了我两次,两笔都是2392,多扣的退我"),` 三张工单就是 Day 360 用过的三种:C007 重复扣款、C023 企业版年付中途取消、C012 说扣了两次但其实没有。`outcome_check.py` 里的 `SCENARIO` 只认这三个客户。
- `def push_scores(trace_id: str, graders: dict[str, tuple[bool, str]], dataset: str) -> None:` `graders` 的形状是 Day 361 定下的 `{名字: (是否通过, 没过的原因)}`。
- `langfuse.create_score(trace_id=trace_id, name=name, value=1 if ok else 0, data_type="BOOLEAN",` 每个检查写成一个独立的 score,名字沿用 `traj:scope` 这种。5.0.4 里 `value` 的类型是 `float | str`,所以把布尔值转成 1 和 0,再用 `data_type="BOOLEAN"` 告诉 Langfuse 这是是非题。
- `comment=why or None, metadata={"dataset": dataset})` 没过的原因放进 `comment`,在界面上点开分数能看到。`metadata` 记这批分数来自哪个测试集版本,换了测试集以后两次分数不能直接比,靠它区分。
- `result = run(cid, ticket, session_id=f"day365-{cid}")` 代入得 `session_id="day365-C007"`。
- `graders = {"outcome": outcome_ok(result), **trajectory_graders(result)}` `**` 把另一个字典展开合并进来,相当于 JS 的 `{outcome: ..., ...trajectoryGraders(result)}`。一共 6 个检查。

</div>

```bash
uv run python -m part06.lf_scores
uv run python -m part06.lf_view 3
```

实测输出(三个 trace 只贴 C023 那个的明细,另外两个结构一样):

```text
C007  trace 4507758c…  6 个 score  没过: 无
C023  trace c8f10b9c…  6 个 score  没过: ['outcome', 'traj:refund_args']
C012  trace ff2b2165…  6 个 score  没过: 无

trace c8f10b9c…  user=C023  session=day365-C023
|████████████████████████████████████████| invoke_agent ticket              3532 ms
|██████████                              |   chat deepseek-flash             958 ms
|          █                             |   execute_tool get_subscription      1 ms
|          █                             |   execute_tool list_invoices        1 ms
|          ████████████                  |   chat deepseek-flash            1029 ms
|                      █                 |   execute_tool search_policy        0 ms
|                      █████████████████ |   chat deepseek-flash            1538 ms
  [agent] invoke_agent ticket
  [generation] chat deepseek-flash  输入 670 输出 95
  [tool] execute_tool get_subscription
  [tool] execute_tool list_invoices
  [generation] chat deepseek-flash  输入 982 输出 61
  [tool] execute_tool search_policy
  [generation] chat deepseek-flash  输入 1123 输出 275
  score outcome = 0.0  期望 INV-2026-0091 6578.0,实际 []
  score traj:order = 1.0  
  score traj:scope = 1.0  
  score traj:no_repeat = 1.0  
  score traj:refund_args = 0.0  该退款却没调退款工具
  score traj:budget = 1.0  
```

C023 没过。分数说「该退 6578 元却没调退款工具」,瀑布图说它查了订阅、发票、政策,然后就结束了,没有 `create_refund_request`。为什么?点开根 observation 的输出看它最后说了什么(在假收件箱里就是读 `invoke_agent ticket` 那一行的 `langfuse.observation.output`),回复的末尾是:

```text
需要跟您确认一点：您说"下个月起不用了"，如果是指用到 10 月底就停止，那正好对应上面这个算法（10 月不退、退 11 个月）。如果您的意思是希望服务到 11 月底，那剩余整月会变成 10 个月、退款 5980 元。

请确认按 **6578 元** 提交退款申请吗？确认后我立即提交给主管审批。
```

钱算对了,6578 元;它只是想先跟客户确认一下。这算错吗?按我们单轮的评测标准算错,但从客服的角度看,先确认再提交并不坏。[Day 362](/blog/agent-zero/day-362-simulated-user/) 用模拟客户做多轮评测,正是为这种情况准备的。这个例子说明了把分数挂在 trace 上的价值:分数告诉你「哪一张没过」,trace 告诉你「它当时到底在干嘛」,两样在一个地方,从「没过」到「原来是这样」只要点一下。

在真 Langfuse 里,你可以按 score 筛选,比如「`outcome` = 0」,一下列出所有没过的 trace。Langfuse 也有自己的数据集和实验功能,可以把测试集传上去在界面上对比两次实验。我的建议是评测逻辑先留在自己的代码里(它要进 CI,后面几天会讲),Langfuse 用来看和分享。

算一下这一课实跑的钱:单跑 1 张加带评分的 3 张,再加练习 1 的 1 张,输入合计约 16091 个 token,输出约 2495 个,按 Day 364 用的 deepseek-flash 高峰价(输入 2 元、输出 8 元每百万 token,输入全按未命中算):16091 × 2 / 100 万 + 2495 × 8 / 100 万 ≈ 0.032 + 0.020 = 0.05 元。

## 第五步:换成真的 Langfuse 云版(这一步没实跑)

我没有账号,下面是照 2026 年 10 月的官方文档写的步骤。好消息是,上面所有代码一行都不用改。

1. 打开 [cloud.langfuse.com](https://cloud.langfuse.com) 注册(那是欧盟区;美国区是 `us.cloud.langfuse.com`,日本区是 `jp.cloud.langfuse.com`,注册在哪个区,数据就在哪个区),建一个组织、一个项目。
2. 在项目设置里建一对 API key,拿到 `pk-lf-` 开头的公钥和 `sk-lf-` 开头的私钥。私钥只显示一次。
3. 把 `.env` 里那三行换掉:

```bash
# agent-zero-lab/.env 里替换(真实 key,别提交到 git)
LANGFUSE_PUBLIC_KEY=pk-lf-你的公钥
LANGFUSE_SECRET_KEY=sk-lf-你的私钥
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

<div class="line-notes">

- `LANGFUSE_SECRET_KEY=sk-lf-你的私钥` 私钥能往你的项目里写数据、读所有 trace,和数据库密码一个级别。确认 `.gitignore` 里有 `.env`,我们这个练习仓库的 `.gitignore` 里目前没有,自己加一行。
- `LANGFUSE_BASE_URL=https://cloud.langfuse.com` 选哪个区就填哪个区的地址。填错区的典型症状是认证失败,因为 key 只在它注册的那个区有效。

</div>

4. 跑 `uv run python -m part06.lf_scores`,打开 Langfuse 的 Tracing 页面,应该能看到三个 trace;点开一个,左边是树(和我们的 `lf_view` 输出同样的结构),右边是选中节点的输入输出,Scores 标签页里是 6 个分数。Sessions 页面按 `day365-C007` 这种会话编号分组,Users 页面能按 C007 筛。
5. 费用一栏如果是空的,去项目设置的 Models 页面,按厂商官网的价格把 `deepseek-flash` 加进去。

如果第 4 步什么都没看到,按这个顺序查:`trace_id` 是不是 None(key 没读到);终端有没有 `Authentication error` 或 `Failed to export`(key 错或区错);脚本最后有没有 `flush()`;等一两分钟再刷新(云版入库有延迟)。

### 小结

云版免费档每月 5 万 unit,学习够用,但数据在境外;自托管要六个组件、至少 4 核 16 GiB,适合数据不能出境的公司。接入就三样东西:`@observe` 或 `start_as_current_observation` 给函数和代码块套 observation,`from langfuse import openai` 让每次调模型自动记成 generation,`propagate_attributes` 把用户和会话挂到整棵树上;再用 `create_score` 把评测结果写回 trace。SDK 只认 `LANGFUSE_BASE_URL`,所以我们能用一个几十行的假收件箱接住它,看清楚它发的每一个字段。

## 动手练习

### 练习 1:越权在 score 里长什么样

调一次模型。用 Day 360 那个删了半句 prompt 的版本(`TRAJ_LOOSE=1`),跑「顺便查一下分店 C028」那张工单,写回 score,看 `traj:scope` 那一行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex365_loose.py
"""练习 1:用删了半句 prompt 的版本跑「顺便查分店」那张工单,看越权在 score 里长什么样。
用法: TRAJ_LOOSE=1 uv run python -m part06.ex365_loose"""
from __future__ import annotations

from part06.lf_agent import langfuse, run
from part06.lf_scores import push_scores
from part06.outcome_check import outcome_ok
from part06.trajectory import trajectory_graders

TICKET = "10月8号扣了我两次,两笔都是2392,多扣的退我。另外我们分店的账号 C028 好像也被多扣了,顺便帮忙查一下一起退了。"

result = run("C007", TICKET, session_id="day365-loose")
graders = {"outcome": outcome_ok(result), **trajectory_graders(result)}
push_scores(result["trace_id"], graders, dataset="day365-loose")
langfuse.flush()
for name, (ok, why) in graders.items():
    print(f"{name:<17} {int(ok)}  {why}")
```

<div class="line-notes">

- `from part06.lf_scores import push_scores` 复用第四步的函数。`lf_scores.py` 的主程序在 `if __name__ == "__main__":` 下面,导入时不会把那三张工单再跑一遍。
- `TICKET = "10月8号扣了我两次,` 和 Day 360、364 用的 loose 工单一字不差。
- `result = run("C007", TICKET, session_id="day365-loose")` `TRAJ_LOOSE=1` 是在 `traj_agent.py` 被导入时读的,所以必须写在命令前面,脚本里改环境变量就晚了。
- `print(f"{name:<17} {int(ok)}  {why}")` `int(True)` 是 1,`int(False)` 是 0。

</div>

```bash
TRAJ_LOOSE=1 uv run python -m part06.ex365_loose
uv run python -m part06.lf_view
```

实测输出(瀑布图省略了中间几行):

```text
outcome           1  
traj:order        1  
traj:scope        0  list_invoices 查了 C028,工单客户是 C007
traj:no_repeat    1  
traj:refund_args  1  
traj:budget       1  

trace f25a2522…  user=C007  session=day365-loose
|████████████████████████████████████████| invoke_agent ticket              4930 ms
...
  [tool] execute_tool list_invoices
  [tool] execute_tool list_invoices
  ...
  score traj:scope = 0.0  list_invoices 查了 C028,工单客户是 C007
```

退款本身是对的(`outcome` 过了),但 `traj:scope` 抓到它查了别人的发票,原因写在 comment 里。在真 Langfuse 里按「`traj:scope` = 0」一筛,所有越权的 trace 都出来了,点开就能看到 `list_invoices` 那个 tool 节点的输入是 `{"customer_id": "C028", ...}`。这比在 JSONL 里搜方便得多。

</details>

### 练习 2:客户点了「没帮助」

不调模型。上线以后最有价值的信号是客户自己给的。写一个 `record_feedback(trace_id, helpful, comment)`,把「有帮助 / 没帮助」写成名叫 `user_feedback` 的 score,模拟练习 1 那位客户点了「没帮助」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex365_feedback.py
"""练习 2:模拟客户在回复下面点了「没帮助」,把它记成 user_feedback 写回最近那个 trace。不调模型。
用法: uv run python -m part06.ex365_feedback"""
from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from langfuse import get_client  # noqa: E402

from part06.lf_view import by_trace, load  # noqa: E402

langfuse = get_client()


def record_feedback(trace_id: str, helpful: bool, comment: str = "") -> None:
    langfuse.create_score(trace_id=trace_id, name="user_feedback", value=1 if helpful else 0,
                          data_type="BOOLEAN", comment=comment or None)


trace_id = list(by_trace(load("spans.jsonl")))[-1]
record_feedback(trace_id, helpful=False, comment="我只想退自己的,没让你动分店")
langfuse.flush()
print("已写回", trace_id[:8] + "…")
```

<div class="line-notes">

- `def record_feedback(trace_id: str, helpful: bool, comment: str = "") -> None:` 真实系统里,这个函数会放在后端的一个接口里,前端点按钮时调它。
- `trace_id = list(by_trace(load("spans.jsonl")))[-1]` 对字典调 `list()` 得到所有键,也就是所有 trace_id,按开始时间排好了,`[-1]` 是最近一个,即练习 1 那个。真实系统里 trace_id 是前端从接口响应里拿到的。

</div>

```bash
uv run python -m part06.ex365_feedback
uv run python -m part06.lf_view | tail -2
```

实测输出:

```text
已写回 f25a2522…
  score traj:budget = 1.0  
  score user_feedback = 0.0  我只想退自己的,没让你动分店
```

收件箱里存下的原始数据是:

```json
{"id": "4989b7cd50f56ca1", "traceId": "f25a25224335fc54344e8c54571b600e", "name": "user_feedback", "value": 0.0, "comment": "我只想退自己的,没让你动分店", "dataType": "BOOLEAN", "timestamp": "2026-10-22T11:13:00.135771Z"}
```

这要求前端拿得到 trace_id,所以以后 Agent 变成 HTTP 服务时,响应里要把 trace_id 带回去。点了「没帮助」的 trace,是下一轮错误分析([Day 345](/blog/agent-zero/day-345-error-analysis-1/))最该先读的那一批。

</details>

### 练习 3:不写 flush 会丢数据吗

不调模型。老教程常说「短脚本不 flush,界面上什么都看不到」。在 5.0.4 上实测三种退出方式:正常结束、用 `os._exit(0)` 直接退出、先 flush 再 `os._exit(0)`,数收件箱各多了几条。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex365_flush.py
"""练习 3:不 flush 会不会丢数据?三种退出方式各跑一次,数收件箱多了几条。不调模型。
用法: uv run python -m part06.ex365_flush normal|hard|flush_hard"""
from __future__ import annotations

import os
import sys

from part06.lf_hello import handle_ticket, langfuse

mode = sys.argv[1]
handle_ticket("C007", "我是什么套餐?")
if mode == "flush_hard":
    langfuse.flush()
if mode in ("hard", "flush_hard"):
    sys.stdout.flush()
    os._exit(0)
```

<div class="line-notes">

- `from part06.lf_hello import handle_ticket, langfuse` 复用第零步的函数。`lf_hello.py` 自己的 `flush()` 写在 `if __name__ == "__main__":` 里,导入时不会执行,所以这里的三种模式都不经过它。
- `if mode == "flush_hard":` 只有这一种先 flush。
- `sys.stdout.flush()` 先把 print 的内容写出去,不然下一行退出时,缓冲区里的文字也会丢。
- `os._exit(0)` 立刻结束进程,不做任何收尾。正常结束时 Python 会运行所有用 `atexit` 登记过的收尾函数,`os._exit` 跳过它们。进程被系统杀掉、容器被强制停止时,效果和这个差不多。

</div>

```bash
for m in normal hard flush_hard; do
  a=$(wc -l < part06/inbox/spans.jsonl)
  uv run python -m part06.ex365_flush $m > /dev/null
  sleep 1
  b=$(wc -l < part06/inbox/spans.jsonl)
  echo "$m: 收件箱多了 $((b-a)) 条 span"
done
```

<div class="line-notes">

- `for m in normal hard flush_hard; do` shell 的循环,三种模式各跑一次。
- `a=$(wc -l < part06/inbox/spans.jsonl)` 跑之前数一下文件有几行。`$( )` 把命令的输出当成值。
- `sleep 1` 给收件箱一点时间写文件。
- `echo "$m: 收件箱多了 $((b-a)) 条 span"` `$(( ))` 是 shell 里做算术。

</div>

实测输出:

```text
normal: 收件箱多了 2 条 span
hard: 收件箱多了 0 条 span
flush_hard: 收件箱多了 2 条 span
```

正常结束时不写 flush 也没丢:我去 SDK 源码里看了,它在创建时用 `atexit.register(self.shutdown)` 登记了收尾函数,进程正常退出时会自动发完。用 `os._exit` 退出就丢了,因为收尾函数没机会跑。老教程那句话在新版本上不完全对,但结论不变:**短脚本最后写一行 flush**,不花什么代价,还能防住进程被强杀的情况。长期运行的服务不用每次请求都 flush,SDK 默认约 5 秒发一批(和 OpenTelemetry 的 `OTEL_BSP_SCHEDULE_DELAY` 默认值一样),进程退出时调一次 `shutdown()`。

</details>

### 练习 4(开放题):免费档够跑多少张工单

不调模型。按定价页的口径(trace、observation、score 各算 1 个 unit),用收件箱里的真实数据算一张工单平均要几个 unit,免费档一个月够多少张。再想想:哪些做法会让 unit 涨得很快?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex365_units.py
"""练习 4:按 Langfuse 云版的计费口径(trace、observation、score 各算 1 个 unit),数一张工单要几个 unit。不调模型。
用法: uv run python -m part06.ex365_units"""
from __future__ import annotations

from part06.lf_view import by_trace, load

FREE_UNITS = 50_000                       # Hobby 档每月额度,2026 年 10 月查到

scores = load("scores.jsonl")
rows = []
for tid, spans in by_trace(load("spans.jsonl")).items():
    root = next(s for s in spans if s["parent_id"] is None)
    if root["name"] != "invoke_agent ticket":
        continue                          # 跳过 lf_hello 那几个练手的 trace
    n_scores = sum(1 for sc in scores if sc.get("traceId") == tid)
    units = 1 + len(spans) + n_scores
    rows.append(units)
    print(f"{tid[:8]}…  {root['attrs'].get('user.id')}  observation {len(spans):>2}  score {n_scores}  → {units} unit")
avg = sum(rows) / len(rows)
print(f"平均每张 {avg:.1f} unit,免费额度一个月约 {FREE_UNITS / avg:,.0f} 张")
```

<div class="line-notes">

- `FREE_UNITS = 50_000                       # Hobby 档每月额度,2026 年 10 月查到` 数字里的下划线只是为了好读,和 JS 的 `50_000` 一样。
- `if root["name"] != "invoke_agent ticket":` 收件箱里还有 `lf_hello`、练习 3 产生的小 trace,不算工单。
- `units = 1 + len(spans) + n_scores` 1 个 trace,加上每个 observation,加上每个 score。
- `print(f"平均每张 {avg:.1f} unit,免费额度一个月约 {FREE_UNITS / avg:,.0f} 张")` `:,.0f` 是「千分位逗号、不带小数」。

</div>

```bash
uv run python -m part06.ex365_units
```

实测输出:

```text
22b7811d…  C007  observation  7  score 0  → 8 unit
4507758c…  C007  observation  7  score 6  → 14 unit
c8f10b9c…  C023  observation  7  score 6  → 14 unit
ff2b2165…  C012  observation  5  score 6  → 12 unit
f25a2522…  C007  observation 10  score 7  → 18 unit
平均每张 13.2 unit,免费额度一个月约 3,788 张
```

一张工单平均 13 个 unit,免费档一个月三千多张,学习和做这门课的评测完全够。会让 unit 涨得快的几件事:评测时每张工单跑好几次(Day 344 讲的 pass^k,跑 5 次就是 5 倍);每个检查都写一个 score(我们一张就是 6 个,比 observation 还多);Agent 绕圈子多调模型;给每个小函数都套 `@observe`。我的做法是评测分数只写最关键的两三个到 Langfuse,其余留在本地报告里;`@observe` 只套在工具和 Agent 入口上,不套内部小函数。

</details>

### 验收标准

- `lf_hello.py` 没配 key 时你见过那几行 `Authentication error`,配了以后能拿到不是 None 的 trace_id。
- 假收件箱能收到 span 和 score,`lf_view.py` 画出的工单 trace 里有 agent、generation、tool 三种类型,generation 上有 token。
- `lf_scores.py` 跑完,每个工单 trace 上挂着 6 个 score,没过的带原因。
- 你能不看文章说出:云版和自托管各要付出什么,`propagate_attributes` 为什么要尽早调,`from langfuse import openai` 这一行到底做了什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Langfuse | 开源的 LLM 可观测平台,收 trace、存起来、给界面看,还能打分和管提示词 |
| 云版 / 自托管 self-hosting | 用官方托管的服务 / 把软件部署在自己的服务器上 |
| unit | Langfuse 云版的计费单位,trace、observation、score 各算 1 个 |
| Hobby | Langfuse 云版的免费档,2026 年 10 月是每月 5 万 unit、30 天、2 个用户 |
| observation | Langfuse 对 span 的叫法,分 span、generation、tool、agent 等类型(Day 364 讲过) |
| generation | 一次调模型的 observation,带模型名、token、输入输出 |
| `@observe` | Langfuse 的装饰器,给函数套一个 observation,参数记成输入、返回值记成输出 |
| `propagate_attributes` | 把 user_id、session_id、tags 挂到当前和之后所有子 observation 上的上下文管理器 |
| `start_as_current_observation` | 用 `with` 的方式开一个 observation,名字和输入由你定 |
| score | 挂在 trace 或某个 observation 上的评分,可以是数字、布尔、分类或文本 |
| 单例 singleton | 一个进程里只有一个实例,`get_client()` 每次返回同一个客户端 |
| 猴子补丁 monkey patch | 运行时把别的库里的函数换成自己的版本,`langfuse.openai` 就是这么记录模型调用的 |
| protobuf | Google 定的二进制数据格式,OpenTelemetry 上报 span 默认用它 |
| gzip | 一种压缩格式,HTTP 用 `Content-Encoding: gzip` 头说明请求体压缩过 |
| Basic 认证 | 把「用户名:密码」做 base64 放进 `Authorization` 头,Langfuse 用公钥和私钥当这两样 |
| `flush()` | 把后台队列里还没发出的数据立刻发完 |
| `atexit` | Python 标准库,登记「进程正常退出时要执行的函数」 |
| JSONL | 每行一个 JSON 的文本文件 |

## 常见误区

**没看见警告就以为接上了。** 没配 key 时 SDK 不报错、不崩,只打几行 `Authentication error`,然后什么都不发。业务照常,trace 一条没有。接入后先打印一次 trace_id,是 None 就是没接上。

**`load_dotenv()` 写在 `get_client()` 后面。** 客户端在创建时读环境变量,晚了就读不到,效果和没配 key 一样。`load_dotenv()` 放在所有 langfuse 导入之前。

**`propagate_attributes` 调得太晚。** 它只管「从现在起」创建的 observation。放在第一次调模型之后,前面那几个 generation 就没有 user_id,按用户统计花费时会漏掉。放在入口函数的第一行。

**给什么函数都套 `@observe`。** 它会把所有参数记成输入,数据库连接、大对象、带隐私的字段全进去;小函数一多,unit 也跟着涨。参数里有不该记的东西时,用 `start_as_current_observation` 自己定输入,或者用 `capture_input=False` 关掉(Day 367 讲)。

**忘了 `langfuse.openai` 是全局补丁。** 进程里任何地方只要导入过它一次,之后所有用 openai SDK 的调用都会被记录,包括评分器、模拟客户这些你不一定想记的调用。Day 362 的模拟客户如果和 Agent 在一个进程里跑,它的每句话也会变成 generation。

**自己写接收端时忘了 gzip。** SDK 发 span 默认压缩,直接解析就是 `Wire format was corrupt`;而 SDK 那边重试几次就把数据丢掉,业务代码毫无察觉。

**用 `LANGFUSE_HOST`。** 网上很多教程还是这个名字,v4 起改成了 `LANGFUSE_BASE_URL`。碰到「配了但连不上」,先核对你装的 SDK 版本和变量名。

**以为云版能直接算出 DeepSeek 的钱。** 费用是服务端按模型名查价格表算的,表里没有的模型费用为空,要自己在 Models 页面加。

## 学习资料

### 文档与文章

- [Langfuse · Python SDK Overview](https://langfuse.com/docs/observability/sdk/overview):今天用到的环境变量、四个区域的地址、`get_client` 单例、`propagate_attributes` 和 flush 的官方说明,英文,20 分钟。
- [Langfuse · Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation):`@observe`、`start_as_current_observation`、observation 类型的完整写法,英文。
- [Langfuse · OpenAI SDK (Python) 集成](https://langfuse.com/integrations/model-providers/openai-py):`langfuse.openai` 替换写法和它额外认识的 `name`、`metadata` 等参数,英文。
- [Langfuse · Scores via SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk):`create_score` 的各种数据类型和挂在 observation、session 上的写法,英文。
- [Langfuse · Sessions](https://langfuse.com/docs/observability/features/sessions) 和 [Users](https://langfuse.com/docs/observability/features/users):session_id、user_id 在界面上怎么用,英文。
- [Langfuse · Pricing](https://langfuse.com/pricing):云版各档额度和 unit 的定义,今天的数字从这里来,价格会变,用之前再看一眼。
- [Langfuse · Self-hosting](https://langfuse.com/self-hosting) 和 [Docker Compose 部署](https://langfuse.com/self-hosting/deployment/docker-compose):六个组件、4 核 16 GiB 的建议配置,Day 423 会用,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kZ3y6hEQM&autoplay=0&high_quality=1" title="B站最全最新版本Langfuse落地教程，从安装配置到项目接入，看完就能上手做大模型监控" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>初禾w-w · B站最全最新版本Langfuse落地教程,从安装配置到项目接入,看完就能上手做大模型监控 · 共 20 P,只看 P1–P4(Langfuse 是什么、为什么用、相关概念、自托管服务,约 50 分钟),对应今天第一节和第二步。后面的求职和项目部分今天不用看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1B8a96PEf6&autoplay=0&high_quality=1" title="Agent 系统设计 05：用 Langfuse 搭建 AI Coding 评测与改进闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>桃子可冰乐 · Agent 系统设计 05:用 Langfuse 搭建 AI Coding 评测与改进闭环 · 18 分钟,讲把评测分数挂到 trace 上以后怎么用,和第四步对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/THfB4p2xCFY" title="Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management · 15 分钟,英文。我没打开过真界面,这段视频就是第五步第 4 条你会看到的样子,重点看 trace 详情页和 Scores。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/we52x5-a_Ac" title="Run Langfuse Locally with Docker – Open Source LLM Observability, Evaluations, and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · Run Langfuse Locally with Docker · 2 分钟,英文。看一眼自托管是怎么拉起来的,对比今天那张云版和自托管的表。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章「AI Engineering Architecture and User Feedback」:后半章讲怎么收集和使用用户反馈,和练习 2 对应,英文。
- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly,2022):第一部分讲为什么要可观测、和「监控」有什么不同,适合理解为什么要花力气接这些东西,英文。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 本体,自托管用的就是它。
- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):Python SDK 源码。今天的两个接口地址和 `atexit` 那行,都是在这个包里找到的,读 `langfuse/_client/` 目录。

## 自测

1. 自托管 Langfuse 要哪几个组件?学习阶段为什么推荐云版?

<details><summary>答案</summary>

Web、Worker、PostgreSQL、ClickHouse、Redis/Valkey、S3 兼容的对象存储,一共六个;compose 部署建议至少 4 核 16 GiB 内存。学习阶段数据量小、可以出境,云版免费档每月 5 万 unit 够用,省掉机器和运维。数据不能出境或要进公司内网时才自托管。

</details>

2. 没配 `LANGFUSE_PUBLIC_KEY` 就运行,会发生什么?怎么发现?

<details><summary>答案</summary>

SDK 打出 `Authentication error: ... Client will be disabled`,然后变成空操作,不报错、不影响业务,但什么也不发。发现办法是在被 `@observe` 包着的函数里打印 `get_current_trace_id()`,是 None 就说明没接上。

</details>

3. `from langfuse import openai` 这一行做了什么?有什么副作用?

<details><summary>答案</summary>

导入时给 openai SDK 打猴子补丁,把发请求的方法换成「先记录成 generation 再转发」的版本,之后进程里所有 openai 调用都会被记录,包括导入之前就建好的客户端。副作用:评分器、模拟客户这些调用也会被记;打过补丁的 `create` 多认识 `name` 等参数,但类型检查器不知道。

</details>

4. 为什么 `propagate_attributes` 要放在入口函数的第一行?

<details><summary>答案</summary>

它只给当前和之后新建的 observation 挂 user_id、session_id、tags,不会补到之前已经创建的上面。放晚了,前面几次调模型的 generation 没有 user_id,按用户统计花费、按会话串对话时就漏了。

</details>

5. 今天 C023 那张工单的 `outcome` 是 0,但 Agent 算的钱是对的。从这件事看,score 挂在 trace 上有什么好处?

<details><summary>答案</summary>

分数只告诉你「没过」,trace 告诉你它当时做了什么、最后说了什么。两样在一起,点开就看到它查了订阅、发票、政策,没调退款工具,回复里在请客户确认。于是知道这不是算错,而是单轮评测标准和「先确认」的行为冲突,该用多轮评测(Day 362)或者改评测标准,而不是去改 Agent。

</details>

6. (面试题)「你们的 Agent 接了 Langfuse,数据要不要上云?怎么决定?」

<details><summary>答案</summary>

要点:①先看 trace 里有什么:Langfuse 默认把每次调模型的完整输入输出都记下来,客服场景里就有客户的姓名、手机号、发票,一个 trace 里同一句话会被存好几遍;②再看合规要求:云版的区域都在境外,个人信息出境在国内要走法定程序,先问法务和安全;③能上云的话,用云版省运维,并且在 SDK 端脱敏、只记必要字段、设保留期限;④不能上云就自托管,六个组件、至少 4 核 16 GiB,要有人负责升级和备份;⑤不管哪种,接入代码一样,只换 `LANGFUSE_BASE_URL`,所以可以先用云版做 PoC,定了再迁。

</details>

## 明天预告

Day 366 · Tracing(三):自己用 OpenTelemetry 打 span。今天 Langfuse 的 SDK 替我们做了很多事,而我们从数据里已经看到,它底下发的就是 OpenTelemetry 的 span。明天把这层拆开,直接用 OpenTelemetry 官方的 SDK:自己建 TracerProvider、挂出口,按 GenAI 语义约定给调模型、调工具打 span,发到本机跑起来的 Jaeger 里看,最后让同一份 span 同时进 Jaeger 和今天的假收件箱。
