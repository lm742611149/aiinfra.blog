---
title: 'Day 119 · Agent Loupe(八):公开演示、脱敏、限流与部署'
description: '把 Agent Loupe 放到网上让招聘方点开就能试:只读演示模式、样例脱敏和残留扫描、按 IP 和全站的重跑限流、按当天实际花费计算的每日上限、只信任确定存在的那层代理、CORS;前端部署到 Cloudflare Pages,后端给 Fly.io 和自己的云服务器两种方案;最后按方法测性能,把数字回填进表格。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'deploy', 'rate-limit', 'cloudflare-pages', 'portfolio', 'agent-60']
series: 'agent-60'
day: 119
lang: 'zh'
---

## 今天要解决的问题

作品集里最有说服力的东西是一个能点开的链接。招聘方或者面试官很少会 clone 你的仓库、配环境变量、起后端;他们会点链接,看三十秒,最多点两下。如果这三十秒里页面打不开、是空的、或者报错,前面四天做的功能等于没做。

但一个能公开访问、背后连着真实大模型的服务,也是一个会被刷的钱包。Agent Loupe 的重跑和评测都会调模型,一个爬虫或者一个好奇的人连点一百次,你的 API 账单就上去了。OWASP 的 LLM 应用十大风险里专门有一条叫「无限制消耗」(Unbounded Consumption),说的就是这件事。

今天要在「让人随便试」和「不被刷爆」之间找一个平衡。学完你应该能:

1. 设计一个演示模式:哪些接口开放、哪些只读、哪些干脆关掉,理由是什么。
2. 把真实 trace 脱敏成可以公开的样例,并且用自动扫描兜底,而不是靠肉眼。
3. 实现按 IP 和全站两层的滑动窗口限流,以及按当天实际花费计算的每日上限;知道为什么「没配价格就拒绝启动」。
4. 正确地取客户端 IP:只信任你确定存在的那一层代理加的头。
5. 前端部署到 Cloudflare Pages,后端部署到 Fly.io 或自己的云服务器,配好 CORS 和 SPA 路由。
6. 用可复现的方法测出一万步 trace 的首屏时间和滚动帧率,回填性能表。

预计用时 6–8 小时,其中部署和排查网络问题可能占一半。前置:Day 113–118 的全部代码;Day 42 和 Day 53 的部署和安全清单。

## 演示站该开放什么

先列出所有接口,按「花不花钱」和「改不改数据」分四类:

| 接口 | 花钱 | 改数据 | 演示模式 |
| --- | --- | --- | --- |
| 列表、详情、步骤、对比(GET) | 否 | 否 | 开放 |
| 导入 trace、新建评测用例(POST) | 否 | 是 | 关闭,管理员 token 可用 |
| 重跑(POST replay) | 是 | 新增一条运行 | 开放,限流 + 每日上限 + 只能跑 1 次、最多 6 步 |
| 批量评测(POST eval-batches) | 是,很多 | 新增很多运行 | 关闭 |

为什么重跑要开放?因为它是 Loupe 最有辨识度的功能。一个只能看不能动的调试器和别人的 trace 查看器没什么区别,让人亲手改一句提示词、从第 3 步重跑、跳到对比页看差异,这个体验才是你想展示的。而重跑的成本是可控的:一次最多 6 步,样例都很短,一次花不了多少钱。

为什么批量评测要关?一批是「用例数 × 次数」次 Agent 运行,演示站上的 15 条用例跑 3 次就是 45 次,一个人点一下的成本相当于几十次重跑。评测页可以开放浏览,看已经跑好的批次和对比结果,但按钮置灰,写明「请在本地跑」。

导入为什么要关?开放导入意味着任何人可以往你的演示站塞任意内容,而你的演示站挂着你的名字。

## 样例脱敏

演示站上的样例最好来自真实的 Agent 运行,这样才有说服力。但真实 trace 里可能有邮箱、手机号、API key、客户名字。哪怕是你自己造的测试数据,也可能顺手填了自己的手机号。

脱敏工具要满足两个要求。第一,**同一个值总是换成同一个占位符**。trace 里客户邮箱出现在用户消息里、出现在工具参数里、出现在工具结果里,三处都要换成 `<EMAIL_1>`,这样读者还能看懂「Agent 拿着这个邮箱去查了客户」。如果每处换成不同的占位符,或者都换成 `***`,trace 的因果关系就丢了。第二,**换完要再扫一遍**,还有命中就报错退出。规则一定会漏,靠扫描兜底比靠人眼可靠。

```python
# agent-loupe/server/loupe/redact.py
# 演示样例脱敏:同一个值总是换成同一个占位符,这样换完以后 trace 里的引用关系还对得上
import json
import re
import sys
from typing import Any

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("KEY", re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}\b")),
    ("EMAIL", re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+?86[\- ]?)?1[3-9]\d{9}(?!\d)")),
    ("CARD", re.compile(r"(?<!\d)(?:\d[ \-]?){15,18}\d(?!\d)")),
    ("IP", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
]


class Redactor:
    def __init__(self, names: list[str] | None = None) -> None:
        self.names = sorted(names or [], key=len, reverse=True)  # 长的先换,免得「张三丰」被换成「PERSON_1丰」
        self.seen: dict[str, str] = {}

    def _token(self, kind: str, value: str) -> str:
        if value not in self.seen:
            n = sum(v.startswith(f"<{kind}_") for v in self.seen.values()) + 1
            self.seen[value] = f"<{kind}_{n}>"
        return self.seen[value]

    def text(self, s: str) -> str:
        for name in self.names:
            if name in s:
                s = s.replace(name, self._token("PERSON", name))
        for kind, pat in PATTERNS:
            s = pat.sub(lambda m, k=kind: self._token(k, m.group(0)), s)
        return s

    def any(self, obj: Any) -> Any:
        if isinstance(obj, str):
            return self.text(obj)
        if isinstance(obj, list):
            return [self.any(v) for v in obj]
        if isinstance(obj, dict):
            return {k: self.any(v) for k, v in obj.items()}
        return obj


def leftovers(obj: Any) -> list[str]:
    """脱敏后再扫一遍,还有命中就说明规则漏了。"""
    raw = json.dumps(obj, ensure_ascii=False)
    return [f"{k}: {m.group(0)}" for k, p in PATTERNS for m in p.finditer(raw)]


if __name__ == "__main__":
    # 用法:uv run python -m loupe.redact in.jsonl out.jsonl 张三 李四
    # 输入是 loupe_sdk 的 JSONL(和 samples/ 里一样),逐行脱敏,整个文件共用一套占位符
    src, dst, *names = sys.argv[1:]
    r = Redactor(names)
    out = [r.any(json.loads(line)) for line in open(src, encoding="utf-8") if line.strip()]
    left = leftovers(out)
    with open(dst, "w", encoding="utf-8") as f:
        f.writelines(json.dumps(x, ensure_ascii=False) + "\n" for x in out)
    print(f"替换了 {len(r.seen)} 个不同的值;残留 {len(left)} 处")
    for x in left[:20]:
        print("  残留", x)
    sys.exit(1 if left else 0)
```

人名没法靠正则识别,所以由命令行传进来一个名单,长的名字先换。`PATTERNS` 里的规则是故意偏严的:`CARD` 会把任何 16 到 19 位的数字串当成卡号,误伤一些订单号也无所谓,演示样例宁可多遮一点。

`leftovers` 的扫描对象是 `json.dumps` 以后的整个字符串,所以不管敏感信息藏在哪一层嵌套里都能扫到。

测试:

```python
# agent-loupe/server/tests/test_redact.py
from loupe.redact import Redactor, leftovers


def test_same_value_same_token_and_names_longest_first():
    r = Redactor(["张三", "张三丰"])
    out = r.any({"a": "张三丰给张三发邮件 zs@example.com", "b": ["再发一次 zs@example.com"]})
    assert out["a"] == "<PERSON_1>给<PERSON_2>发邮件 <EMAIL_1>"
    assert out["b"] == ["再发一次 <EMAIL_1>"]


def test_keys_phones_cards_and_leftovers():
    r = Redactor()
    fake_key = "sk-" + "abcdefghijklmnop1234"  # 拆开写,免得仓库的密钥扫描把测试数据当成真 key
    s = r.text(f"key {fake_key} 电话 13812345678 卡 4111 1111 1111 1111")
    assert "sk-" not in s and "138" not in s and "4111" not in s
    assert leftovers({"x": s}) == []
```

脱敏脚本的输入输出都是 Day 112 `loupe_sdk` 的 JSONL(一行 run_start、若干行 step、一行 run_end),和 `samples/` 里的样例同一个格式,逐行处理,整个文件共用一套占位符。

再配两个小脚本:一个用 Day 113 的 `load_trace` 把库里的运行导出成同样的 JSONL,一个在演示站启动时把 `samples/` 下的样例导入空库。导入走的是 Day 112 的 `import_any` 加 Day 113 的 `fill_costs`,和首页上传文件是同一条路;超过 5 MB 的文件(一万步的压测样例)跳过。导入前会再跑一次 `leftovers`,这是第三道保险:就算有人绕过脱敏流程直接往 `samples/` 里放了文件,也进不了演示站。

```python
# agent-loupe/server/scripts/export_run.py  把库里一条运行导出成 loupe_sdk 的 JSONL(和 samples/ 里的格式一样)
import json
import os
import sys

from loupe import db

conn = db.connect(os.environ.get("LOUPE_DB", "loupe.db"))
run_id, out = sys.argv[1], sys.argv[2]
trace = db.load_trace(conn, run_id)
if trace is None:
    sys.exit(f"找不到 {run_id}")
r = trace.run
lines = [{"type": "run_start", "id": r.id, "name": r.name, "started_at": r.started_at.isoformat(), "tags": r.tags}]
lines += [{"type": "step", **s.model_dump(mode="json")} for s in trace.steps]
lines.append({"type": "run_end", "id": r.id, "ended_at": r.ended_at.isoformat(), "status": r.status})
with open(out, "w", encoding="utf-8") as f:
    f.writelines(json.dumps(x, ensure_ascii=False) + "\n" for x in lines)
print(f"{run_id}: {len(trace.steps)} 步 -> {out}")
```

```python
# agent-loupe/server/scripts/seed_demo.py  演示站启动前执行:库是空的就导入 samples/ 下的脱敏样例
import os
import pathlib
import sys

from loupe import db
from loupe.importers import import_any
from loupe.pricing import fill_costs
from loupe.redact import leftovers

conn = db.connect(os.environ.get("LOUPE_DB", "loupe.db"))
if conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] > 0:
    print("库里已经有数据,跳过")
    sys.exit(0)
samples = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../samples")
for f in sorted(samples.glob("*.jsonl")):
    if f.stat().st_size > 5_000_000:  # 一万步的压测样例不放进演示站
        continue
    text = f.read_text(encoding="utf-8")
    if left := leftovers(text):  # 最后一道保险:没脱干净的样例拒绝导入
        sys.exit(f"{f.name} 里还有疑似敏感信息:{left[:3]}")
    for t in import_any(text):  # Day 112 的导入器 + Day 113 的成本补全,和 /api/import 走同一条路
        db.save_trace(conn, fill_costs(t))
        print("导入", f.name, t.run.id, len(t.steps), "步")
```

完整流程:

```bash
cd server
uv run python -m scripts.export_run weather-011033 raw.jsonl
uv run python -m loupe.redact raw.jsonl ../samples/day117_weather.jsonl 张三 李四   # 名单换成样例里出现的人名
rm raw.jsonl                                                                        # 未脱敏的文件别留在仓库目录里
```

脱敏脚本退出码非 0 时说明有残留,打开输出看是哪一类、补规则或补名单,再跑一遍。最后**自己从头到尾读一遍样例**。自动扫描是兜底,不是替代。

## 限流和每日上限

需要两种限制,它们防的是不同的东西。

**限流**防的是单个来源短时间内的大量请求:脚本、爬虫、或者一个点上瘾的访客。按 IP 每小时 5 次,再加一个全站每小时 60 次的总闸,防止大量不同 IP 同时来(比如你的链接被贴到某个论坛)。

**每日上限**防的是限流挡不住的情况:限流按请求计数,但每次请求花的钱不一样。上限按当天实际花掉的钱算:把今天所有 `replay` 和 `eval` 标签运行的 `total_cost_usd` 加起来,超过 `DAILY_BUDGET_USD` 就拒绝。这比「每天最多 N 次」更准,因为它直接约束你关心的那个量。

限流用滑动窗口:记下每个 key 最近一小时内的请求时间戳,数量超过上限就拒绝,并告诉客户端还要等多少秒(`Retry-After` 头)。固定窗口(每个整点清零)实现更简单,但会被卡在边界上的突发绕过,比如 10:59 发 5 次、11:00 再发 5 次。

```python
# agent-loupe/server/loupe/guard.py
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from loupe.pricing import load_prices

# 演示模式下会调模型、会花钱的接口
COSTLY = ("/replay", "/api/eval-batches")


@dataclass
class Settings:
    demo: bool = os.environ.get("LOUPE_DEMO") == "1"
    admin_token: str = os.environ.get("LOUPE_ADMIN_TOKEN", "")
    daily_budget_usd: float = float(os.environ.get("DAILY_BUDGET_USD", "1.0"))
    per_ip_per_hour: int = int(os.environ.get("REPLAY_PER_IP_PER_HOUR", "5"))
    global_per_hour: int = int(os.environ.get("REPLAY_GLOBAL_PER_HOUR", "60"))
    # 前面是谁:"" 直连 / "cloudflare" / "fly" / "xff"(自己的 Caddy、Nginx 一层反代)
    trust_proxy: str = os.environ.get("TRUST_PROXY", "")
    cors: str = os.environ.get("LOUPE_CORS", "http://localhost:5173")  # 和 Day 113 create_app 读的是同一个变量


class SlidingWindow:
    """最近一小时内的请求时间戳。单进程够用;多进程/多机要换成 Redis。"""

    def __init__(self, limit: int, window_s: float = 3600) -> None:
        self.limit, self.window = limit, window_s
        self.hits: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> tuple[bool, int]:
        now = now if now is not None else time.time()
        with self.lock:
            q = [t for t in self.hits.get(key, []) if now - t < self.window]
            if len(q) >= self.limit:
                self.hits[key] = q
                return False, int(self.window - (now - q[0])) + 1
            q.append(now)
            self.hits[key] = q
            return True, 0


def spent_today(conn: sqlite3.Connection) -> float:
    """今天(UTC)所有重跑和评测运行花掉的钱。成本是 Day 113 的 fill_costs 按 prices.json 算的。"""
    start = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00")
    row = conn.execute(
        "SELECT COALESCE(SUM(total_cost_usd), 0) FROM runs WHERE started_at >= ? "
        "AND id IN (SELECT run_id FROM run_tags WHERE tag IN ('replay', 'eval'))", (start,)).fetchone()
    return float(row[0])


def client_ip(request: Request, s: Settings) -> str:
    """只信任你确定存在的那一层代理加的头。客户端自己也能发这些头,信错了限流就形同虚设。"""
    h = request.headers
    if s.trust_proxy == "cloudflare" and h.get("cf-connecting-ip"):
        return h["cf-connecting-ip"]
    if s.trust_proxy == "fly" and h.get("fly-client-ip"):
        return h["fly-client-ip"]
    if s.trust_proxy == "xff" and h.get("x-forwarded-for"):
        # 取最后一个:它是我们自己的反代追加的;第一个是客户端想写什么就写什么
        return h["x-forwarded-for"].split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def deny(request: Request, s: Settings, status: int, detail: str, headers: dict[str, str] | None = None) -> JSONResponse:
    """拒绝时自己补上 CORS 头。这个中间件包在 CORSMiddleware 外面,它返回的响应不会经过 CORS,
    不补的话浏览器只会报「跨域失败」,前端读不到 detail,用户看不到「请求太频繁」。"""
    h = dict(headers or {})
    origin = request.headers.get("origin")
    if origin and origin in s.cors.split(","):
        h["Access-Control-Allow-Origin"] = origin
        h["Vary"] = "Origin"
        h["Access-Control-Expose-Headers"] = "Retry-After"  # 不声明的话跨域时前端读不到这个头
    return JSONResponse({"detail": detail}, status_code=status, headers=h)


def install(app: FastAPI, conn: sqlite3.Connection, s: Settings | None = None) -> Settings:
    s = s or Settings()
    if s.demo and not load_prices():
        # 价格表是空的,成本永远算成 0,花费上限形同虚设。宁可起不来
        raise RuntimeError("演示模式必须有可用的 prices.json,否则每日花费上限不生效")
    per_ip, overall = SlidingWindow(s.per_ip_per_hour), SlidingWindow(s.global_per_hour)

    @app.middleware("http")
    async def demo_guard(request: Request, call_next):
        if not s.demo or request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)
        path = request.url.path
        if s.admin_token and request.headers.get("authorization") == f"Bearer {s.admin_token}":
            return await call_next(request)
        if not any(k in path for k in COSTLY):
            return deny(request, s, 403, "演示站是只读的,导入和新建用例请在本地跑")
        if spent_today(conn) >= s.daily_budget_usd:
            return deny(request, s, 429, "今天的演示额度用完了,明天(UTC)再来,或者在本地跑")
        ok, wait = per_ip.allow(client_ip(request, s))
        if ok:
            ok, wait = overall.allow("all")
        if not ok:
            return deny(request, s, 429, f"请求太频繁,{wait} 秒后再试", {"Retry-After": str(wait)})
        return await call_next(request)

    return s
```

几个值得展开的点。

**花费直接用 Day 113 算好的成本。** 每条重跑和评测运行在保存时都经过了 `fill_costs`,按 `server/prices.json` 算好了 `total_cost_usd`。`spent_today` 只是把今天带 `replay` 或 `eval` 标签的运行的成本加起来,标签用的是 Day 113 建好的 `run_tags` 表,不用在 JSON 字符串里做模糊匹配。

**价格表为空就拒绝启动。** `prices.json` 里没有任何模型(或者模型名对不上),所有运行的成本都是 0,每日上限永远不会触发。这是那种「看起来有保护,其实没有」的情况,比没有保护更危险,因为你以为自己是安全的。所以演示模式下 `load_prices()` 返回空,直接抛异常,服务起不来。让错误在部署时暴露,而不是在账单上暴露。还要提醒一句:模型名对不上价格表时,`fill_costs` 只是跳过那一步、不报错。换模型以后先在 `prices.json` 里加上它,再部署。

**花费检查放在限流前面。** 额度用完以后,所有人都应该看到同一个明确的提示,而不是有人看到「请求太频繁」、有人看到「额度用完」。

**拒绝的响应要自己补 CORS 头。** 这个坑是我用浏览器测的时候才发现的。Day 113 的 `create_app` 一开头就加了 `CORSMiddleware`(读 `LOUPE_CORS`),而 `guard.install` 在最后用 `@app.middleware("http")` 加中间件。Starlette 里后加的中间件包在外层,所以 guard 直接返回的 403、429 不会经过 CORS 中间件,响应里没有 `Access-Control-Allow-Origin`。浏览器看到这种响应,不会把内容交给前端代码,`fetch` 只抛一个「跨域失败」,用户看不到「请求太频繁」,只看到「重跑失败」。所以 `deny` 函数自己检查请求的 Origin,在允许名单里就补上 CORS 头,再加一个 `Access-Control-Expose-Headers: Retry-After`,否则跨域时前端读不到这个头。

**`client_ip` 只信任你确定存在的那一层代理。** 这是我第一版写错的地方。第一版是:如果开了 `TRUST_PROXY`,就取 `cf-connecting-ip`,没有的话取 `X-Forwarded-For` 的第一个值。问题是,`X-Forwarded-For` 是一个逗号分隔的列表,每经过一层代理就往后追加一个地址,**第一个值是客户端自己填的**。攻击者每次请求带一个随机的 `X-Forwarded-For: 1.2.3.4`,你的反代把真实 IP 追加在后面,而你取了第一个,限流就被完全绕过了。同理,如果你的服务前面并没有 Cloudflare,却信任 `cf-connecting-ip`,攻击者自己发这个头就行。

所以 `TRUST_PROXY` 不是开关,而是一个明确的声明:我的服务前面是 Cloudflare(取 `cf-connecting-ip`)、是 Fly.io 的代理(取 `fly-client-ip`)、还是一层我自己的 Caddy/Nginx(取 `X-Forwarded-For` 的**最后一个**值,那是我的反代追加的)。声明 `cloudflare` 的前提是源站只接受来自 Cloudflare 的流量(防火墙只放行 Cloudflare 的 IP 段,或者用 Cloudflare Tunnel),否则别人绕过 Cloudflare 直连源站,照样可以伪造这个头。

**状态在进程内存里,所以只能跑一个进程。** 两个 worker 就是两份计数,限流变成两倍;多台机器就是 N 倍。演示站一个进程完全够用。如果以后要扩展,把 `SlidingWindow` 换成 Redis 的有序集合(`ZADD` 时间戳、`ZREMRANGEBYSCORE` 清理、`ZCARD` 计数)就行,接口不用变。

测试:

```python
# agent-loupe/server/tests/test_guard.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from loupe import db, guard
from loupe.models import Run


def make(tmp_path, monkeypatch, **kw):
    monkeypatch.setattr(guard, "load_prices", lambda: {"m": {"input": 1.0, "output": 1.0}})
    conn = db.connect(str(tmp_path / "g.db"))
    app = FastAPI()

    @app.post("/api/import")
    def imp() -> dict:
        return {"ok": True}

    @app.post("/api/runs/{rid}/replay")
    def rep(rid: str) -> dict:
        return {"ok": True}

    guard.install(app, conn, guard.Settings(demo=True, **kw))
    return TestClient(app), conn


def test_sliding_window():
    w = guard.SlidingWindow(2, window_s=10)
    assert w.allow("a", 0)[0] and w.allow("a", 1)[0]
    ok, wait = w.allow("a", 2)
    assert not ok and wait == 9
    assert w.allow("a", 11)[0]


def test_demo_is_read_only_except_replay(tmp_path, monkeypatch):
    c, _ = make(tmp_path, monkeypatch, admin_token="t")
    assert c.post("/api/import").status_code == 403
    assert c.post("/api/import", headers={"authorization": "Bearer t"}).status_code == 200
    assert c.post("/api/runs/x/replay").status_code == 200


def test_rate_limit(tmp_path, monkeypatch):
    c, _ = make(tmp_path, monkeypatch, per_ip_per_hour=2)
    codes = [c.post("/api/runs/x/replay").status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_budget(tmp_path, monkeypatch):
    c, conn = make(tmp_path, monkeypatch, daily_budget_usd=0.5)
    from loupe.models import Trace
    from loupe.replay import now
    t = now()
    db.save_trace(conn, Trace(run=Run(id="r", name="x", started_at=t, ended_at=t, total_cost_usd=0.6,
                                      tags=["replay"]), steps=[]))
    assert c.post("/api/runs/x/replay").status_code == 429


def test_demo_without_prices_refuses_to_start(tmp_path, monkeypatch):
    monkeypatch.setattr(guard, "load_prices", lambda: {})
    with pytest.raises(RuntimeError):
        guard.install(FastAPI(), db.connect(str(tmp_path / "x.db")), guard.Settings(demo=True))


def test_client_ip_ignores_forged_headers():
    from starlette.requests import Request

    def req(headers: dict[str, str]) -> Request:
        raw = [(k.encode(), v.encode()) for k, v in headers.items()]
        return Request({"type": "http", "headers": raw, "client": ("10.0.0.1", 1234)})

    forged = {"x-forwarded-for": "1.2.3.4, 203.0.113.9", "cf-connecting-ip": "1.2.3.4"}
    assert guard.client_ip(req(forged), guard.Settings()) == "10.0.0.1"            # 直连:谁的头都不信
    assert guard.client_ip(req(forged), guard.Settings(trust_proxy="xff")) == "203.0.113.9"  # 只信最后一跳
    assert guard.client_ip(req(forged), guard.Settings(trust_proxy="cloudflare")) == "1.2.3.4"


def test_denials_carry_cors_headers(tmp_path, monkeypatch):
    """被拒绝的跨域请求也要带 CORS 头,不然前端只看到「跨域失败」。"""
    c, _ = make(tmp_path, monkeypatch, cors="https://loupe.example.com")
    r = c.post("/api/import", headers={"origin": "https://loupe.example.com"})
    assert r.status_code == 403
    assert r.headers["access-control-allow-origin"] == "https://loupe.example.com"
    assert c.post("/api/import", headers={"origin": "https://evil.example"}).headers.get("access-control-allow-origin") is None
```

`test_client_ip_ignores_forged_headers` 直接构造一个带伪造头的请求,验证三种模式各自取到了正确的地址。安全相关的逻辑,一定要有一个「攻击者会怎么做」的测试。

在 `create_app` 末尾、`return app` 前面加两行:

```python
    from loupe import guard

    guard.install(app, conn)  # Day 119:演示模式的只读、限流和每日花费上限
```

`test_denials_carry_cors_headers` 守护的就是上面那个 CORS 的坑。

### 路由里的演示模式收紧

限流按请求计数,而重跑接口有个 `repeat` 参数,一次请求可以跑 3 次。演示模式下把它锁成 1,把最大步数从 12 降到 6,并关掉批量评测。`routes.py` 顶部加 `import os`,然后改 Day 117、118 写的两个接口:

```python
    @app.post("/api/runs/{run_id}/replay")
    def replay_run(run_id: str, req: ReplayRequest) -> dict:
        demo = os.environ.get("LOUPE_DEMO") == "1"
        if not 1 <= req.repeat <= (1 if demo else 3):  # 演示站限流按请求计,repeat=3 等于花三倍的钱
            raise HTTPException(400, "repeat 超出范围(演示站只能 1 次)")
        try:
            runs = [replay.fork_run(conn, run_id, req.from_step, req.overrides, llm_call,
                                    live_tools=LIVE_TOOLS if req.live_tools else None,
                                    max_steps=6 if demo else 12)
                    for _ in range(req.repeat)]
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"runs": [r.id for r in runs], "compare_url": f"/diff?a={run_id}&b={runs[0].id}"}
```

```python
    @app.post("/api/eval-batches")
    def run_batch(req: BatchRequest) -> dict:
        if os.environ.get("LOUPE_DEMO") == "1":
            raise HTTPException(403, "演示站不开放批量评测,一批几十次模型调用,请在本地跑")
        # 后面不变
```

本地验证一下(价格按你查到的填,这里只为了让服务能起来):

```bash
cd server
LOUPE_DEMO=1 LOUPE_CORS=https://loupe.example.com REPLAY_PER_IP_PER_HOUR=1 \
  uv run uvicorn loupe.app:create_app --factory --port 8000
# 另一个终端
curl -s -i -X POST localhost:8000/api/import -H 'origin: https://loupe.example.com'
curl -s -i -X POST localhost:8000/api/runs/nope/replay -H 'content-type: application/json' -d '{"from_step":0}'
curl -s -i -X POST localhost:8000/api/runs/nope/replay -H 'content-type: application/json' -d '{"from_step":0}'
```

我这里第一条返回 403 和「演示站是只读的」,响应头里有 `access-control-allow-origin: https://loupe.example.com`;第二条是 400「run nope 不存在」;第三条是 429,带 `retry-after: 3600`。注意第二条虽然失败了,也占用了一次额度:中间件在路由之前计数,不知道请求会不会成功。对演示站来说这是可以接受的,甚至是对的,因为一个反复请求不存在资源的客户端本身就可疑。再试一下把 `prices.json` 里的模型都删掉(或者用 `LOUPE_PRICES` 指向一个只有 `{}` 的文件)再启动,服务应该直接报错退出。

## CORS 和前端配置

前端和后端分开部署,前端在 `loupe.你的域名`(Cloudflare Pages),后端在 `api.loupe.你的域名`(或者 Fly.io 给的 `xxx.fly.dev`),浏览器会把前端发给后端的请求当成跨域请求。Day 113 的 `create_app` 已经加了 `CORSMiddleware`,允许的来源读环境变量 `LOUPE_CORS`(默认是本地的 `http://localhost:5173`),部署时把它设成前端的域名。只放行你自己的前端域名,不要写 `*`:写了 `*` 以后,任何网站都可以在访客的浏览器里调你的重跑接口,消耗的是你的额度。

前端还要知道后端在哪。Day 114 的 `api.ts` 里所有请求都写的是相对路径 `/api/...`,本地开发靠 Vite 的代理转给 8000 端口;前后端分开部署以后,相对路径会发到 Cloudflare Pages 自己身上。改法是在 `api.ts` 里加一个前缀,`getJson`、`importFile` 和 Day 117 的 `postJson` 里的 `fetch` 都拼上它:

```typescript
// Day 119:前后端分开部署时,构建前端时设 VITE_API_BASE=https://后端地址;本地开发不设,走 Vite 代理
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(API_BASE + url);
  // 后面不变
}
// importFile 里:fetch(API_BASE + '/api/import', ...)
// postJson 里:fetch(API_BASE + url, ...)
```

Day 118 的 `exportCasesUrl` 是个下载链接,也要带上前缀。本地开发时不设它,请求发给同源的 `/api`,由 Vite 的开发代理转给 8000 端口(`vite.config.ts` 里的 `server.proxy`)。构建演示站时设成后端的完整地址。注意 `VITE_` 开头的变量会被**打包进前端代码**,任何人都能在浏览器里看到,所以这里只能放公开的地址,永远不要放 key。

演示站顶部加一个横幅,告诉访客这是什么、能做什么、限额是多少,以及怎么在本地跑完整版:

```tsx
// agent-loupe/web/src/components/DemoBanner.tsx
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

export function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <div className="demo-banner" role="note">
      这是只读演示站:数据是脱敏过的样例,能看、能对比、能从任意一步重跑(每人每小时 5 次,全站每天有花费上限)。
      想导入自己的 trace,<a href="https://github.com/你的用户名/agent-loupe">在本地跑</a>只要三条命令。
    </div>
  );
}
```

在 `App.tsx` 里把 `<DemoBanner />` 放在 `<Routes>` 上面,样式在 `index.css` 末尾加一行 `.demo-banner { padding: 6px 20px; background: var(--sel); border-bottom: 1px solid var(--line); }`。限流返回 429 时,Day 117 的重跑对话框会直接显示后端的提示文字(「请求太频繁,3600 秒后再试」或「今天的演示额度用完了」),这就是为什么后端的错误信息要写成给人看的中文。

最后一个容易忘的:SPA 路由。用户直接打开 `https://loupe.你的域名/diff?a=...&b=...`,Cloudflare Pages 会去找 `diff` 这个文件,找不到就 404。在 `web/public/_redirects` 里写一行,把所有路径都交给 `index.html`,由 React Router 处理:

```text
/*    /index.html   200
```

## 部署前端:Cloudflare Pages

如果你的课程站已经在 Cloudflare Pages 上(这门课的站点就是),流程是一样的。把仓库推到 GitHub,在 Cloudflare 控制台 Workers & Pages → Create → Pages → Connect to Git,选仓库,然后:

- **Root directory**:`web`
- **Build command**:`pnpm build`
- **Build output directory**:`dist`
- **环境变量**:`NODE_VERSION=22`、`VITE_API_BASE=https://你的后端地址`、`VITE_DEMO=1`(后端那边对应地把 `LOUPE_CORS` 设成这个前端的域名)

Cloudflare Pages 会根据 `pnpm-lock.yaml` 自动用 pnpm 安装依赖。构建跑的是 `package.json` 里的 `build` 脚本(`tsc --noEmit && vite build`),类型检查不过,部署就失败,这是好事。

部署好以后在 Custom domains 里绑定 `loupe.你的域名`。

## 部署后端:两种方案

后端是一个单进程的 FastAPI 加一个 SQLite 文件。它对机器的要求很低,关键约束只有两个:**只能有一个进程**(限流状态和 SQLite),**磁盘要持久化**(重启后数据还在)。

### 方案 A:Fly.io

Fly.io 用 Dockerfile 构建镜像,支持挂载持久卷,机器空闲时可以自动停、来请求时自动启,适合流量很小的演示站。

Dockerfile 放在 `server/` 下,但要在仓库根目录构建,因为它需要把根目录的 `samples/` 也拷进去:

```dockerfile
# agent-loupe/server/Dockerfile  在仓库根目录构建:docker build -f server/Dockerfile -t loupe .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/loupe ./loupe
COPY server/scripts ./scripts
COPY server/prices.json ./prices.json
COPY samples ./samples
ENV LOUPE_DB=/data/loupe.db PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8000
# 只能一个 worker:限流计数在进程内存里,SQLite 也不适合多进程同时写
CMD ["sh", "-c", "python -m scripts.seed_demo samples && uvicorn loupe.app:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
```

容器启动时先跑 `seed_demo`(库是空的才导入),再起 uvicorn。`prices.json` 拷到 `/app` 下,Day 113 的 `pricing.py` 默认就在包的上一级目录找它。uv 的镜像版本我写死了,你用的时候换成当前版本。

仓库根目录放 `fly.toml`:

```toml
# agent-loupe/fly.toml  app 名字要全局唯一,改成你自己的
app = "agent-loupe-demo"
primary_region = "nrt"

[build]
  dockerfile = "server/Dockerfile"

[env]
  LOUPE_DEMO = "1"
  TRUST_PROXY = "fly"
  DAILY_BUDGET_USD = "0.5"
  REPLAY_PER_IP_PER_HOUR = "5"
  LOUPE_CORS = "https://loupe.你的域名"
  LLM_BASE_URL = "https://api.deepseek.com"
  LLM_MODEL = "deepseek-flash"
  LLM_EXTRA_BODY = '{"thinking": {"type": "disabled"}}'
  # 价格用镜像里的 server/prices.json(Day 113),改价格就改那个文件再部署

[[mounts]]
  source = "loupe_data"
  destination = "/data"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

部署命令(先装好 `flyctl` 并登录):

```bash
fly launch --no-deploy --copy-config        # 用上面的 fly.toml 建应用,不立刻部署
fly volumes create loupe_data --size 1 --region nrt
fly secrets set LLM_API_KEY=sk-你的key     # key 只放 secrets,不写进 fly.toml
fly deploy
fly scale count 1                           # 确保只有一台机器
```

`TRUST_PROXY = "fly"`,因为 Fly 的边缘代理会加 `Fly-Client-IP` 头。`primary_region` 选离你的访客近的,Fly 的区域代码可以用 `fly platform regions` 查。

两个说明。第一,我写这篇的时候本机没有 Docker,上面的 Dockerfile 没有真的构建过;我按它的步骤在一个干净目录里手动走了一遍(`uv sync --frozen --no-dev --no-install-project`、拷文件、跑 `seed_demo` 再起 uvicorn),服务能起来、样例能导入。你第一次构建如果报错,大概率是路径问题,对着 `COPY` 那几行查。第二,Fly.io 的计费方式这几年变过好几次,部署前去它的定价页确认当前的免费额度和价格,我这里不写数字。

### 方案 B:自己的云服务器

一台最便宜的云服务器就够。不用 Docker 也行,直接用 uv:

```bash
# 服务器上
curl -LsSf https://astral.sh/uv/install.sh | sh
git clone https://github.com/你的用户名/agent-loupe.git /opt/agent-loupe
cd /opt/agent-loupe/server && uv sync --frozen --no-dev
mkdir -p /var/lib/loupe
```

用 systemd 托管进程。环境变量放在一个只有 root 能读的文件里:

```ini
# /etc/systemd/system/loupe.service
[Unit]
Description=Agent Loupe API
After=network.target

[Service]
WorkingDirectory=/opt/agent-loupe/server
EnvironmentFile=/etc/loupe.env
ExecStartPre=/opt/agent-loupe/server/.venv/bin/python -m scripts.seed_demo ../samples
ExecStart=/opt/agent-loupe/server/.venv/bin/uvicorn loupe.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure
DynamicUser=yes
StateDirectory=loupe

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/loupe.env (chmod 600)
LOUPE_DB=/var/lib/loupe/loupe.db
LOUPE_DEMO=1
TRUST_PROXY=xff
DAILY_BUDGET_USD=0.5
LOUPE_CORS=https://loupe.你的域名
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}'
```

两个 JSON 值外面的单引号别省。systemd 解析 EnvironmentFile 有自己的引号规则,不包起来的话 JSON 里的双引号有可能被当成引号处理掉,`json.loads` 报错,服务起不来。整体用单引号包住最稳,第一次启动后用 `journalctl -u loupe` 确认没有 JSON 解析错误。

uvicorn 只监听 `127.0.0.1`,外面只能通过反代访问。反代用 Caddy,它会自动申请和续期 HTTPS 证书:

```text
# /etc/caddy/Caddyfile
api.loupe.你的域名 {
    reverse_proxy 127.0.0.1:8000
}
```

`TRUST_PROXY=xff`,因为前面只有一层 Caddy,它会把真实客户端地址追加到 `X-Forwarded-For` 的末尾。如果你还在 Caddy 前面套了 Cloudflare 的代理(橙色云朵),那就是两层代理,`X-Forwarded-For` 的最后一个是 Cloudflare 的地址,应该改成 `TRUST_PROXY=cloudflare`,并且在服务器防火墙上只放行 Cloudflare 的 IP 段。

`DynamicUser=yes` 让 systemd 用一个临时的无权限用户跑服务,`StateDirectory=loupe` 会自动创建 `/var/lib/loupe` 并给这个用户写权限。这两行能挡住相当一部分「服务被打穿以后顺手改了系统文件」的情况。这份配置是示例,路径和域名按你的环境改,第一次启动用 `journalctl -u loupe -f` 看日志。

## 性能:测出来,再填表

5C 规格里的性能指标是「一万步 trace 的首屏时间、滚动帧率」。这两个数字要你在自己的机器、自己的浏览器上测,我给方法,不给数字。

一万步的样例 Day 114 已经造好了:`samples/synthetic_10k.jsonl`(用 `samples/gen_synthetic.py` 生成,不调模型,固定随机种子,每次造出来一样),run id 是 `syn10000`。导入它:

```bash
curl -s -F file=@../samples/synthetic_10k.jsonl localhost:8000/api/import
```

**接口耗时。** 用 curl 量步骤接口:前端实际用的是一页 5000 条的轻步骤,再对比一下带完整内容的 `full=true`:

```bash
curl -s -o /dev/null -w "%{time_total}s %{size_download}B\n" "localhost:8000/api/runs/syn10000/steps?from=0&limit=5000"
curl -s -o /dev/null -w "%{time_total}s %{size_download}B\n" "localhost:8000/api/runs/syn10000/steps?from=0&limit=5000&full=true"
```

**首屏时间。** Day 114 的 `RunDetail` 工具栏已经会显示「10000 步,加载 X ms」,那是从开始拉步骤到全部拉完的时间。要把渲染也算进去,在 Day 114 的 `Timeline` 组件第一次渲染出行的地方加一行 `performance.mark('loupe:first-rows')`,刷新页面后在控制台执行 `performance.getEntriesByName('loupe:first-rows')[0].startTime`,得到从页面开始加载到第一批行出现的毫秒数。测五次取中位数,第一次往往偏慢(冷缓存)。也可以用 Chrome DevTools 的 Performance 面板录一次,在时间线上找到对应的 mark。

**滚动帧率。** 把下面的脚本粘到控制台,它会在 5 秒内把列表匀速从头滚到底,统计每一帧的间隔:

```javascript
// agent-loupe/web/scripts/scroll-fps.js
// 粘到 DevTools 控制台运行:匀速把列表从头滚到底,统计帧间隔。默认滚的是 Day 114 时间轴的 .timeline-scroll
(async (SELECTOR = '.timeline-scroll', SECONDS = 5) => {
  const el = document.querySelector(SELECTOR) ?? document.scrollingElement;
  const total = el.scrollHeight - el.clientHeight;
  const gaps = [];
  let last = performance.now();
  const start = last;
  await new Promise((done) => {
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      const p = Math.min(1, (now - start) / (SECONDS * 1000));
      el.scrollTop = total * p;
      if (p < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  gaps.shift();
  gaps.sort((a, b) => a - b);
  const pct = (q) => gaps[Math.floor(q * (gaps.length - 1))];
  const result = {
    frames: gaps.length,
    avgFps: +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1),
    p95FrameMs: +pct(0.95).toFixed(1),
    longFrames: gaps.filter((g) => g > 50).length, // 超过 50ms 的帧,用户会感觉到卡
  };
  console.table(result);
  return result;
})();
```

默认滚动的是 Day 114 时间轴的滚动容器 `.timeline-scroll`。我打开 `syn10000` 的详情页跑过这个脚本,能正常输出 `avgFps`、`p95FrameMs` 和 `longFrames`。`longFrames` 是超过 50 毫秒的帧数,这类帧用户能明显感觉到卡顿,比平均帧率更值得看。

**测两种环境**:开发者电脑上的 Chrome,和 DevTools 里 CPU 降速 4 倍(Performance 面板的 CPU throttling),后者大致模拟一台普通笔记本。

| 指标 | 本机 | CPU 4× 降速 | 线上演示站 |
| --- | --- | --- | --- |
| 步骤接口 limit=5000 耗时 | | | |
| 步骤接口 limit=5000&full=true 耗时 | | | |
| 首屏时间(中位数,ms) | | | |
| 滚动 avgFps | | | |
| 滚动 p95 帧间隔(ms) | | | |
| 滚动 longFrames | | | |

填完这张表,README 里就可以写「一万步 trace 首屏 X 毫秒、滚动 Y 帧」,并附上测量方法。没有方法的性能数字,有经验的面试官是不会信的。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="演示站部署架构:访客浏览器访问 Cloudflare Pages 上的前端,前端跨域请求后端,后端前面一层代理,后端里依次经过只读检查、花费上限、限流,再到路由和 SQLite,只有重跑会调用模型 API">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="100" width="96" height="44" fill="none" stroke="var(--ink-soft)"/>
    <text x="64" y="126" text-anchor="middle" fill="var(--ink)">访客浏览器</text>
    <rect x="140" y="30" width="150" height="44" fill="none" stroke="var(--ink-soft)"/>
    <text x="215" y="50" text-anchor="middle" fill="var(--ink)">Cloudflare Pages</text>
    <text x="215" y="66" text-anchor="middle" fill="var(--ink-faint)">React 静态文件</text>
    <rect x="140" y="160" width="150" height="44" fill="none" stroke="var(--ink-soft)"/>
    <text x="215" y="180" text-anchor="middle" fill="var(--ink)">代理</text>
    <text x="215" y="196" text-anchor="middle" fill="var(--ink-faint)">Fly / Caddy / CF</text>
    <rect x="318" y="140" width="190" height="104" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="413" y="160" text-anchor="middle" fill="var(--compute)">FastAPI(单进程)</text>
    <text x="330" y="180" fill="var(--ink-soft)">1 只读检查</text>
    <text x="330" y="196" fill="var(--ink-soft)">2 今日花费 ≥ 上限?</text>
    <text x="330" y="212" fill="var(--ink-soft)">3 IP / 全站限流</text>
    <text x="330" y="228" fill="var(--ink-soft)">4 路由 + SQLite 卷</text>
    <rect x="530" y="160" width="94" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="577" y="186" text-anchor="middle" fill="var(--mem)">模型 API</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="112" y1="112" x2="140" y2="60"/><line x1="112" y1="132" x2="140" y2="180"/>
    <line x1="290" y1="182" x2="318" y2="182"/><line x1="508" y1="182" x2="530" y2="182" stroke="var(--mem)"/>
  </g>
  <text x="300" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">CORS 只放行前端域名;只有重跑会走到模型</text>
</svg>
<figcaption>演示站的请求路径。所有保护都在调用模型之前完成,模型 API 的 key 只存在后端的 secrets 里。</figcaption>
</figure>

## 上线检查清单

部署完,按这张单子过一遍。每一项都要实际操作,不要「应该没问题」。

- [ ] 用无痕窗口打开演示站,不登录、不带任何 cookie,首页能看到样例运行。
- [ ] 直接打开一个深层链接(比如对比页的完整 URL),不是 404。
- [ ] 从某一步重跑一次,能跳到对比页;马上再点 5 次,第 6 次看到「请求太频繁」。
- [ ] `curl -X POST https://后端/api/import` 返回 403。
- [ ] 带一个伪造的 `X-Forwarded-For` 连续请求重跑,确认限流照样生效。
- [ ] 把 `DAILY_BUDGET_USD` 临时调到 0.0001,重跑一次后再试,看到「今天的演示额度用完了」;改回来。
- [ ] 用一个空的价格表启动(`LOUPE_PRICES` 指向只有 `{}` 的文件),服务拒绝启动。
- [ ] 在演示站页面上连续重跑到被限流,看到的是「请求太频繁」,而不是「跨域失败」。
- [ ] 在浏览器开发者工具的网络面板里搜一遍 `sk-`,前端代码和响应里都没有 key。
- [ ] 从另一个域名的页面用 `fetch` 调后端,被 CORS 拦住。
- [ ] 重启后端(Fly 上 `fly apps restart 你的应用名`,服务器上 `systemctl restart loupe`),数据还在,样例没有被重复导入。
- [ ] 在模型服务商的控制台给这个 key 设一个月度消费上限。这是最后一道闸,代码里的所有保护都失效时,它还在。
- [ ] 性能表填完。

最后一条值得多说一句:代码里的每日上限依赖你填对了价格表、依赖计数逻辑没有 bug。服务商那边的硬上限不依赖你的任何代码。纵深防御的意思就是不把安全押在任何一层上。

## 动手练习

1. **把演示站部署上线。** 方案 A 或 B 选一个,前端绑定自己的域名,把上线检查清单逐项打勾。
2. **准备样例。** 仓库里已经有 `day09_cities.jsonl`、`day117_weather.jsonl`、`synthetic_small.jsonl` 三条。再从你自己的 SupportPilot 里导出一条有失败步骤的运行(适合演示重跑和存用例),经过脱敏脚本,通读一遍,放进 `samples/`。
3. **限流换成 Redis(选做)。** 把 `SlidingWindow` 改成基于 Redis 有序集合的实现,接口不变;写测试证明两个进程共享计数。
4. **演示站的「重置」。** 访客的重跑会不断往库里加运行。写一个每天执行一次的清理脚本:删掉超过 24 小时的 `replay` 标签运行,保留样例。在 Fly 上可以用定时机器,在服务器上用 systemd timer 或 cron。
5. **填性能表。** 用今天给的方法测完三列,写进 README 的「性能」一节,注明测量环境。

**验收标准:** 演示站能公开访问,上线检查清单全部打勾;样例里扫描不出敏感信息;性能表三列都有真实数字和测量环境说明;能对着 `client_ip` 讲清楚为什么取 `X-Forwarded-For` 的最后一个值。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 演示模式(demo mode) | 公开部署时的受限模式:浏览开放,花钱和改数据的操作受限或关闭 |
| 脱敏(redaction) | 把敏感信息换成占位符;同一个值换成同一个占位符以保留引用关系 |
| 滑动窗口限流 | 统计最近一段时间内的请求数,超过上限就拒绝,没有固定窗口的边界突发问题 |
| 每日上限(daily budget) | 按当天实际花费累计,超过就拒绝调用模型的接口 |
| Retry-After | 响应头,告诉客户端多少秒后再试 |
| X-Forwarded-For | 代理追加客户端地址的请求头,逗号分隔,第一个值可以被客户端伪造 |
| CORS | 浏览器的跨域访问控制,后端通过响应头声明允许哪些来源调用 |
| SPA 回退(fallback) | 静态托管时把所有路径都返回 index.html,由前端路由处理 |
| 持久卷(volume) | 容器重启后数据仍然保留的磁盘 |
| 纵深防御 | 多层互相独立的保护,任何一层失效时其他层仍然有效 |

## 常见误区

**限流取 X-Forwarded-For 的第一个值。** 那是客户端自己写的,随便伪造。只信任你确定存在的那层代理,取它追加的那个值。

**每日上限靠计数,不靠花费。** 每次请求的成本差别很大。按实际花费累计,才能约束你真正关心的量。

**价格表是空的,上限永远不触发,自己还不知道。** 有保护的假象比没有保护更危险。关键配置缺失时拒绝启动。

**中间件自己返回的拒绝没带 CORS 头。** 前端只看到「跨域失败」,用户不知道是被限流了。拒绝时按允许名单补上 CORS 头,并暴露 `Retry-After`。

**CORS 写 `*`。** 任何网站都能在访客浏览器里替你花额度。只放行自己的前端域名。

**把 key 放进 VITE_ 环境变量。** 它会被打包进前端代码,所有人都能看到。key 只在后端的 secrets 里。

**多 worker、多机器部署演示站。** 内存里的限流计数被分成多份,SQLite 多进程写也会出问题。演示站一个进程足够,要扩展就先把状态挪到 Redis。

**只靠代码里的保护。** 在服务商控制台给 key 设硬性消费上限,这一层不依赖你的任何代码。

**只脱敏不扫描,或者只扫描不通读。** 规则一定有漏,扫描兜底;扫描也一定有漏,发布前自己读一遍。

## 学习资料

### 文档与文章

- [OWASP · LLM10:2025 Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/):「无限制消耗」风险的官方描述和防护建议,今天的限流和花费上限就是对它的回应,15 分钟。
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/):看 Git 集成、构建配置和环境变量几节;[Redirects](https://developers.cloudflare.com/pages/configuration/redirects/) 一节讲 `_redirects` 文件的语法,20 分钟。
- [Vite · Env Variables and Modes](https://vite.dev/guide/env-and-mode):`VITE_` 前缀的含义和「会被打包进客户端」的警告,10 分钟。
- [FastAPI · CORS](https://fastapi.tiangolo.com/tutorial/cors/):`CORSMiddleware` 的参数和 `allow_origins` 的写法,10 分钟。
- [Fly.io · Python 文档](https://fly.io/docs/python/):FastAPI 应用部署到 Fly 的官方指南,看 Dockerfile 和 volumes 部分,20 分钟。
- [Chrome DevTools · Performance](https://developer.chrome.com/docs/devtools/performance):录制性能、CPU 降速、看长任务,30 分钟。
- [web.dev · Interaction to Next Paint](https://web.dev/articles/inp):理解为什么「长帧」比平均帧率更能反映卡顿体验,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vMLp6cENP&autoplay=0&high_quality=1" title="个人项目怎么免费上线?Cloudflare Pages 全流程实战教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>飞行认知 · 个人项目怎么免费上线?Cloudflare Pages 全流程实战教程 · 22 分钟,从连 GitHub 到绑定域名的完整操作,对着它把前端部署上去。</figcaption>
</figure>

- 玩代码的预测师《25. 通过Docker部署FastAPI应用程序》(BV1SmG3zAEkF,12 分钟):FastAPI 打包成 Docker 镜像的过程,和今天的 Dockerfile 对照看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jzGzw98Eikk" title="How to Deploy Machine Learning Models with FastAPI, Docker, and Fly.io | End-to-End Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataTalksClub · How to Deploy Machine Learning Models with FastAPI, Docker, and Fly.io | End-to-End Tutorial · 直播回放较长,直接拖到部署到 Fly.io 的那一段看。</figcaption>
</figure>

- Stackless Tech《Deploy FastAPI on Cloud Run for FREE: A step-by-step tutorial》(YouTube `bcYmfHOrOPM`,6 分钟):如果你想用 Google Cloud Run 当第三种方案,看这个。注意 Cloud Run 的文件系统不持久,SQLite 要换成别的存储。

### 书籍

- Michael T. Nygard《Release It! Design and Deploy Production-Ready Software》第 2 版(Pragmatic Bookshelf, 2018):第 5 章「Stability Patterns」,讲超时、断路器、隔舱、快速失败、限流这些模式。今天的「花费上限放在限流前面」「关键配置缺失就拒绝启动」都是快速失败的思路。

### 开源项目与代码

- [laurentS/slowapi](https://github.com/laurentS/slowapi):FastAPI/Starlette 的限流库,支持 Redis 后端。今天手写是为了讲清原理,真要上生产可以看看它怎么做的。
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):FastAPI 官方的全栈模板,部署相关的配置(Docker、反代、环境变量)可以参考。
- [kevin1024/vcrpy](https://github.com/kevin1024/vcrpy):Day 117 用过的思路,它对录制文件里敏感信息的处理(`filter_headers`、`before_record_request`)和今天的脱敏是一回事。

## 自测

1. 演示站为什么开放重跑、关闭批量评测?

<details><summary>答案</summary>

重跑是 Loupe 最有辨识度的功能,单次成本可控(只跑 1 次、最多 6 步),值得让访客亲手试。批量评测一次是用例数乘以次数的 Agent 运行,成本是重跑的几十倍,对演示没有额外价值,浏览已有结果就够了。

</details>

2. 为什么限流时不能取 `X-Forwarded-For` 的第一个值?应该取哪个?

<details><summary>答案</summary>

`X-Forwarded-For` 是每经过一层代理就往后追加一个地址,第一个值由客户端自己提供,可以任意伪造,取它会让限流被轻易绕过。应该取你确定存在的那层可信代理追加的值:前面只有一层自己的反代时取最后一个;前面是 Cloudflare 或 Fly 时用它们专门的头,并且确保源站不能被绕过直连。

</details>

3. 为什么演示模式下价格表为空要拒绝启动,而不是打一行警告继续运行?

<details><summary>答案</summary>

没配价格,所有运行的成本都算成 0,每日上限永远不会触发,系统看起来有保护实际没有。警告很容易被忽略,拒绝启动让问题在部署时暴露,而不是在账单上暴露。

</details>

4. 脱敏时为什么要「同一个值换成同一个占位符」?

<details><summary>答案</summary>

trace 里同一个值会出现在多处(用户消息、工具参数、工具结果),一致的占位符保留了它们之间的引用关系,读者还能看懂 Agent 拿着哪个值做了什么。每处换成不同的占位符或统一换成星号,trace 的因果关系就丢了,样例失去了演示价值。

</details>

5. 演示站为什么只能跑一个进程?如果要扩成多台机器,要改什么?

<details><summary>答案</summary>

限流的计数在进程内存里,多个进程各自计数,限流变成 N 倍;SQLite 也不适合多进程并发写。扩展时把限流状态挪到 Redis(有序集合实现滑动窗口),数据库换成 Postgres 或者给 SQLite 加单写入者的设计,花费统计也要从共享的数据库里算。

</details>

6. 资深面试题:你把一个调用大模型的 demo 公开到网上,第二天发现 API 账单是平时的 50 倍。你怎么排查?事后要加哪些防护?

<details><summary>答案</summary>

先止血:在服务商控制台禁用或轮换 key、设硬性上限,把服务切成只读。再排查:看服务商的用量明细(哪个模型、哪个时间段、请求量还是单次 token 量异常),对照自己的 trace 和访问日志,确定是大量请求(被刷)、少量请求但每次巨长(上下文爆炸、死循环、max_steps 失效),还是 key 泄露被别人直接用(用量和你的访问日志对不上)。事后的防护分层:服务商侧硬上限和告警;key 只在后端、定期轮换、扫描仓库和前端产物;应用侧按真实花费的每日上限和单次运行的步数、token 上限;正确的客户端识别和限流;演示功能的范围收紧;以及花费监控和异常告警(比如每小时花费超过日均 3 倍就通知)。复盘时把这次的触发路径写成测试或检查清单项。

</details>

## 明天预告

Agent Loupe 已经在线上跑起来了。明天(Day 120)是作品一的最后一天:**开源发布与作品包装**。写一个三十秒能看懂的 README(动图、快速开始、架构、性能数字和测量方法),写三篇 ADR 记下这几天最重要的取舍(签名用决定而不是输入、cassette miss 返回错误而不是中止、用例存快照),准备一个两分钟演示视频的分镜和网站上的案例页,再练习在面试里用三种长度讲这个项目。
