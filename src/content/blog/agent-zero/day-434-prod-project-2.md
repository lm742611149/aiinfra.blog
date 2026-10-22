---
title: 'Day 434 · 小项目(二):部署到公网和故障演练'
description: '第七部分最后一天。先在本机用 Caddy 搭一个和线上同样结构的「预发」,加上按 IP 限流,亲眼看到伪造 X-Forwarded-For 直连能绕过、经过 Caddy 就绕不过;再写好上服务器要用的 Dockerfile、compose 和 Caddyfile。然后做一次故障演练:先写预期再动手,杀进程、上游变慢和 429、库打不开、审计日志写不进、客户端断开,七项里有两项和预期对不上,当场修好。'
pubDate: 2026-10-23
regime: none
tags: ['deploy', 'caddy', 'rate-limit', 'game-day', 'production', 'project', 'agent-zero']
series: 'agent-zero'
day: 434
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 433](/blog/agent-zero/day-433-week62-review/) 是第 62 周复习:默写了 `deploy.yml` 和 `chat()` 的四道闸门,写了一个只读文件、不花钱的发版前检查 `review62.py`,它第一次跑就发现 Day 432 说要接进 CI 的预检一直没接;还给会话锁 409 和单轮超时补上了不调模型的测试。到这里,[Day 432](/blog/agent-zero/day-432-prod-project-1/) 那个查账服务的代码、清单、测试、流水线都是绿的。

绿只说明「我想到的情况都对」。今天是第七部分的最后一天,做两件事:把服务放到反向代理后面、上公网;然后故意把它弄坏,看它在我**没想到**的情况下表现如何。

## 今天要解决的问题

学完今天你应该能:

1. 在本机用 Caddy 搭一个和线上结构相同的「预发」,用 Day 432 的 `smoke.py` 和 `smoke_stream.py` 隔着代理检查核心路径和流式。
2. 给服务加上按 IP 限流,并说清楚为什么「应用端口不能对公网开放」:实测直连时伪造 `X-Forwarded-For` 就能绕过限流,经过 Caddy 就绕不过。
3. 写出上服务器用的 `Dockerfile`、`compose.yaml`、`Caddyfile`,知道部署后要跑哪几条命令确认上线成功。
4. 按故障演练(game day)的方法做七项演练:每项先写预期再动手,把「实际」一列填满,对不上的当场修好或写进 README。

今天新东西有两个:**按 IP 限流**和**故障演练**。部署本身用的都是 [Day 420](/blog/agent-zero/day-420-linux-1/) 到 [Day 427](/blog/agent-zero/day-427-ci-cd/) 学过的东西。

这是项目日,预计 3.5–4 小时。前置:Day 432 的 `part07/service/`、`smoke.py`、`smoke_stream.py`,Day 433 的 `tests/test_service_slow.py`,上一周 Day 420–427 的服务器、Docker、compose、HTTPS 和 CI/CD。没有云服务器和域名也能学完前两条和第四条,第三条读懂、用工具检查过配置就算过。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `too_many()` 和演练表的「预期」一列默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:你早就做过故障演练

前端开发里有个你肯定用过的东西:Chrome DevTools 的 Network 面板,把 throttling 调成 Slow 3G 或者 Offline,然后刷新页面,看加载状态转不转、骨架屏出不出来、断网时有没有一句人话。你在做的就是故障演练:**在可控的时候,故意制造一个故障,看系统的反应和你设计的是不是一样。**

后端和 Agent 服务的故障演练是同一个思路,只是能弄坏的东西更多:进程会被杀,上游模型 API 会慢、会 429,数据库文件会打不开,磁盘会写满,用户会在流式输出到一半时关掉页面。软件工程里管这件事叫 **game day**,有的团队一个季度做一次,把它排进日历,大家一起在白天弄坏系统,而不是等它半夜自己坏。

关键规矩只有一条:**先写预期,再动手。** 不写预期直接动手,无论发生什么你都会觉得「嗯,合理」,演练就白做了。预期和实际对不上的地方,要么是代码有 bug,要么是你对系统的理解有偏差,两样都是最值钱的发现。

## 第一步:在本机搭一个和线上一样的「预发」

线上的结构是:用户 → Caddy(443 端口,负责 HTTPS)→ uvicorn 里的 FastAPI 应用。Day 432 的冒烟都是直连 uvicorn 做的,中间少了一层代理。很多问题恰好出在这一层:流式被缓冲、客户端 IP 变了、代理超时比应用短。所以先在本机把这一层补上,这种「和生产结构一样、但不对外」的环境叫**预发**(staging)。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="本机预发和线上结构对照:上面一行是本机,curl 或 smoke 脚本经 8434 端口的 Caddy 转发到 8001 端口的 uvicorn;下面一行是线上,浏览器经 443 端口的 Caddy 容器转发到 api 容器的 8000 端口。两边应用都会读账本库、写审计日志、调模型 API">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="22" fill="var(--ink)">本机预发(今天实跑)</text>
    <rect x="20" y="34" width="110" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="75" y="54" text-anchor="middle" fill="var(--ink)">curl / smoke</text>
    <text x="75" y="70" text-anchor="middle" fill="var(--ink-faint)">你的终端</text>
    <rect x="170" y="34" width="120" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="230" y="54" text-anchor="middle" fill="var(--ink)">Caddy :8434</text>
    <text x="230" y="70" text-anchor="middle" fill="var(--ink-faint)">http,不发证书</text>
    <rect x="330" y="34" width="130" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="395" y="54" text-anchor="middle" fill="var(--ink)">uvicorn :8001</text>
    <text x="395" y="70" text-anchor="middle" fill="var(--ink-soft)">main.py 0.3.0</text>
    <line x1="130" y1="57" x2="170" y2="57" stroke="var(--ink-soft)"/>
    <line x1="290" y1="57" x2="330" y2="57" stroke="var(--ink-soft)"/>
    <text x="20" y="160" fill="var(--ink)">线上(服务器,今天没实跑)</text>
    <rect x="20" y="172" width="110" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="75" y="192" text-anchor="middle" fill="var(--ink)">浏览器</text>
    <text x="75" y="208" text-anchor="middle" fill="var(--ink-faint)">面试官</text>
    <rect x="170" y="172" width="120" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="230" y="192" text-anchor="middle" fill="var(--ink)">caddy :443</text>
    <text x="230" y="208" text-anchor="middle" fill="var(--ink-faint)">自动 HTTPS</text>
    <rect x="330" y="172" width="130" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="395" y="192" text-anchor="middle" fill="var(--ink)">api :8000</text>
    <text x="395" y="208" text-anchor="middle" fill="var(--ink-soft)">不映射到公网</text>
    <line x1="130" y1="195" x2="170" y2="195" stroke="var(--ink-soft)"/>
    <line x1="290" y1="195" x2="330" y2="195" stroke="var(--ink-soft)"/>
    <rect x="500" y="34" width="124" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="562" y="57" text-anchor="middle" fill="var(--ink)">模型 API</text>
    <rect x="500" y="98" width="124" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="562" y="115" text-anchor="middle" fill="var(--ink)">ledger.db</text>
    <text x="562" y="129" text-anchor="middle" fill="var(--ink-faint)">只读</text>
    <rect x="500" y="162" width="124" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="562" y="179" text-anchor="middle" fill="var(--ink)">audit.jsonl</text>
    <text x="562" y="193" text-anchor="middle" fill="var(--ink-faint)">只追加</text>
    <rect x="500" y="226" width="124" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="562" y="243" text-anchor="middle" fill="var(--ink)">假上游 :8999</text>
    <text x="562" y="257" text-anchor="middle" fill="var(--ink-faint)">只在演练时用</text>
    <line x1="460" y1="57" x2="500" y2="53" stroke="var(--ink-faint)"/>
    <line x1="460" y1="66" x2="500" y2="117" stroke="var(--ink-faint)"/>
    <line x1="460" y1="195" x2="500" y2="181" stroke="var(--ink-faint)"/>
    <line x1="460" y1="75" x2="500" y2="245" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="20" y="262" fill="var(--ink-soft)">两边只有三处不同:端口、有没有证书、进程是怎么被拉起来的</text>
    <text x="20" y="282" fill="var(--ink-faint)">(本机靠一个 while 循环,线上靠 compose 的 restart: unless-stopped)</text>
  </g>
</svg>
<figcaption>上面是今天在本机实跑的预发,下面是要上服务器的结构。蓝色是我们的应用,琥珀色是它依赖的外部东西。虚线的假上游只在故障演练时把 LLM_BASE_URL 指过去。</figcaption>
</figure>

Caddy 是一个单文件的 Go 程序,在 [Day 425](/blog/agent-zero/day-425-deploy-route/) 选部署路线时用来做反向代理和自动 HTTPS。本机没装的话,去它的 GitHub Releases 下载对应平台的压缩包,解压出一个 `caddy` 可执行文件就行,不用安装。我用的是 2026 年 10 月 3 日发布的 v2.11.7(Intel Mac 选 `mac_amd64`,M 系列芯片选 `mac_arm64`):

```bash
mkdir -p ~/tools && cd ~/tools
curl -sL -o caddy.tgz https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_mac_amd64.tar.gz
tar xzf caddy.tgz caddy && ./caddy version
```

<div class="line-notes">

- `mkdir -p ~/tools && cd ~/tools` 放工具的目录,和练习仓库分开,别把一个 50MB 的二进制提交进 git。
- `curl -sL -o caddy.tgz` `-L` 跟随跳转(GitHub 的下载链接会跳到存储服务),`-o` 存成文件。
- `tar xzf caddy.tgz caddy && ./caddy version` 只解出 `caddy` 这一个文件。实测输出 `v2.11.7 h1:yj0Y4f...`。

</div>

本机用的 Caddyfile 和线上只差两处:不申请证书、监听一个普通端口。

```text
# agent-zero-lab/deploy/Caddyfile.local(本机演练用:http、不申请证书)
{
	admin off
	auto_https off
}

:8434 {
	reverse_proxy 127.0.0.1:8001
}
```

<div class="line-notes">

- `{` 最上面一对没有名字的大括号是全局选项,对整个 Caddy 生效。
- `admin off` Caddy 默认会在 2019 端口开一个管理接口,本机演练用不着,关掉。
- `auto_https off` 不自动申请 HTTPS 证书。本机没有域名,申请也会失败。线上那份没有这一行。
- `:8434 {` 监听本机 8434 端口的所有请求。线上这里写的是域名,Caddy 看到域名才会去申请证书。
- `reverse_proxy 127.0.0.1:8001` 把请求原样转发给 8001 端口的 uvicorn。Caddy 的文档写明,响应是 `text/event-stream` 时它会每写一次就立刻刷给客户端,SSE 不用额外配置。

</div>

开三个终端。第一个起应用,第二个起 Caddy,第三个跑检查:

```bash
# 终端 1
cd ~/agent-zero-lab && uv run uvicorn part07.service.main:app --port 8001
# 终端 2
cd ~/agent-zero-lab && ~/tools/caddy run --config deploy/Caddyfile.local --adapter caddyfile
# 终端 3
cd ~/agent-zero-lab
uv run python part07/smoke.py http://127.0.0.1:8434 C007
uv run python -m part07.smoke_stream http://127.0.0.1:8434 C012
```

<div class="line-notes">

- `uv run uvicorn part07.service.main:app --port 8001` 应用换到 8001,把好记的端口留给代理。
- `caddy run --config deploy/Caddyfile.local --adapter caddyfile` `run` 是在前台跑(Ctrl+C 就停),`--adapter caddyfile` 告诉它配置文件是 Caddyfile 格式。
- `uv run python part07/smoke.py http://127.0.0.1:8434 C007` Day 432 的冒烟脚本,这次打的是 Caddy 的端口。
- `uv run python -m part07.smoke_stream http://127.0.0.1:8434 C012` Day 432 练习 2 的流式检查。那天它说「部署到公网、前面加了反向代理之后再跑一次才是真正的检查」,今天就是这一次。

</div>

```text
healthz: 200 {'status': 'ok', 'version': '0.3.0'}
chat: 200
  +0.9s {'type': 'tool', 'name': 'my_invoices', 'args': {}, 'ok': True}
  +1.9s {'type': 'done', 'tokens_in': 893, 'tokens_out': 207, 'cost': 0.003442}
事件序列: ['status', 'tool', 'status', 'message', 'done']
SMOKE OK
content-type=text/event-stream; charset=utf-8
status@0.01s  tool@0.81s  status@0.81s  message@1.81s  done@1.81s
STREAM OK
```

版本号是 0.3.0,因为下一步要加限流,我已经先把版本升了。status 事件 0.01 秒就到,和直连时一样,说明 Caddy 没有攒着不发。如果你用的是 Nginx,这里很可能是 status 和 done 同时在 1.8 秒到,要在配置里加 `proxy_buffering off`。

## 第二步:按 IP 限流,以及代理后面看到的 IP 是谁

Day 432 的已知限制里写着:没有限流,一个人每秒发一百个请求,预算会兜住总花费,但会把所有人的额度一起用完。公网 demo 最常见的事故就是这个:地址被人贴到某个群里,有人写个循环一直刷,第二天面试官打开,看到的是「今天的演示额度已用完」。

**限流**就是限制同一个来源在一段时间里最多发多少个请求,超了直接拒绝。按什么算「同一个来源」?公开 demo 没有真正的用户系统,能用的只有 IP。规则我定成每个 IP 每分钟最多 10 个对话请求,够面试官正常试用,挡得住脚本狂刷。

实现用**滑动窗口**:每个 IP 一个队列,记下它最近每次请求的时间;新请求来了,先把一分钟以前的记录从队头扔掉,剩下的还有 10 条就拒绝。

```python
# agent-zero-lab/part07/service/main.py 里新加的部分(其余和 Day 432 相同)
from collections import defaultdict, deque

from fastapi import FastAPI, Header, HTTPException, Request

VERSION = "0.3.0"
hits: dict[str, deque[float]] = defaultdict(deque)


def too_many(ip: str) -> bool:
    now = time.monotonic()
    q = hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_per_minute:
        return True
    q.append(now)
    return False


@app.post("/api/chat")
async def chat(request: Request, body: ChatIn, x_demo_customer: str = Header()) -> StreamingResponse:
    ip = request.client.host if request.client else "unknown"
    if too_many(ip):
        raise HTTPException(429, "请求太频繁,一分钟后再试", headers={"Retry-After": "60"})
    if x_demo_customer not in DEMO_CUSTOMERS:
        raise HTTPException(401, "未登录")
```

<div class="line-notes">

- `from collections import defaultdict, deque` `deque` 是双端队列,两头都能快速进出。从队头扔旧记录用 `popleft()`,比 list 的 `pop(0)` 快,相当于 JS 数组的 `shift()` 但不用挪动后面的元素。
- `from fastapi import FastAPI, Header, HTTPException, Request` 多 import 一个 `Request`,用它拿客户端地址。
- `VERSION = "0.3.0"` 加了一个功能,升小版本。部署后看 `/healthz` 的版本号就知道新代码上去没有。
- `hits: dict[str, deque[float]] = defaultdict(deque)` 每个 IP 一个队列,第一次见到的 IP 自动建一个空队列。和会话锁、预算一样存在进程内存里,多进程部署时要挪到 Redis(Day 432 的已知限制同理)。
- `now = time.monotonic()` 单调时钟,只会往前走,不受系统改时间影响。算「过了多少秒」都用它,不用 `time.time()`。
- `while q and now - q[0] > 60:` 队头是最早的一次。它距离现在超过 60 秒就扔掉,一直扔到队头在一分钟以内为止。
- `if len(q) >= settings.rate_per_minute:` 一分钟内已经有 10 次了,这次拒绝。注意被拒绝的请求**不记进去**,否则一个一直在刷的脚本会永远被锁死,正常用户等一分钟就该恢复。
- `q.append(now)` 没超就记下这一次。
- `async def chat(request: Request, body: ChatIn, x_demo_customer: str = Header())` 参数里写一个类型是 `Request` 的参数,FastAPI 就会把原始请求对象传进来。
- `ip = request.client.host if request.client else "unknown"` 客户端的 IP。为什么经过代理以后这里还是真实的用户 IP,下面实测。
- `raise HTTPException(429, "请求太频繁,一分钟后再试", headers={"Retry-After": "60"})` 放在**最前面**,比登录还早:没登录的人狂刷 401 也是在浪费你的资源。`Retry-After` 是标准响应头,告诉客户端多少秒后再试,写 SDK 的人会读它(Day 389 讲过 openai SDK 会按这个头等待)。

</div>

`config.py` 里同样加一行,让上限能用环境变量调:

```python
    rate_per_minute: int = field(default_factory=lambda: int(_num("RATE_PER_MINUTE", 10)))
```

<div class="line-notes">

- `rate_per_minute: int = field(default_factory=lambda: int(_num("RATE_PER_MINUTE", 10)))` 加在 `max_message_chars` 下面那一行,写法和 Day 432 的其他上限一样,演练时可以临时调小。

</div>

重启终端 1 的应用,经过 Caddy 连发 12 个请求。我故意用不存在的客户 C999,这样前 10 个会 401,**一次模型都不调**,这个实验一分钱不花:

```bash
B=http://127.0.0.1:8434
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $B/api/chat -H "X-Demo-Customer: C999" \
    -H "content-type: application/json" -d '{"text":"hi"}'
done; echo
curl -s -i -X POST $B/api/chat -H "X-Demo-Customer: C999" -H "content-type: application/json" \
  -d '{"text":"hi"}' | grep -iE "^HTTP|retry-after|detail"
```

<div class="line-notes">

- `for i in $(seq 1 12); do` shell 的循环,`seq 1 12` 产出 1 到 12。
- `curl -s -o /dev/null -w "%{http_code} "` 不要响应正文,只打印状态码和一个空格,12 个结果排成一行。
- `curl -s -i` `-i` 把响应头也打印出来,好看 `Retry-After`。

</div>

```text
401 401 401 401 401 401 401 401 401 401 429 429 
HTTP/1.1 429 Too Many Requests
Retry-After: 60
{"detail":"请求太频繁,一分钟后再试"}
```

第 11 个开始 429。现在是今天第一个有意思的实验。很多客户端(包括其他代理、CDN)会在请求头 `X-Forwarded-For` 里写「原始客户端的 IP」,uvicorn 默认信任来自 127.0.0.1 的这个头,用它当 `request.client.host`。那么,攻击者自己伪造这个头,每次换一个假 IP,是不是就能绕过限流?分两种情况试:直接打 uvicorn 的 8001 端口,和经过 Caddy 的 8434 端口。

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8001/api/chat \
    -H "X-Forwarded-For: 203.0.113.$i" -H "X-Demo-Customer: C999" \
    -H "content-type: application/json" -d '{"text":"hi"}'
done; echo
for i in $(seq 1 3); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8434/api/chat \
    -H "X-Forwarded-For: 198.51.100.$i" -H "X-Demo-Customer: C999" \
    -H "content-type: application/json" -d '{"text":"hi"}'
done; echo
```

<div class="line-notes">

- `-X POST http://127.0.0.1:8001/api/chat` 第一组绕过 Caddy,直连应用端口。
- `-H "X-Forwarded-For: 203.0.113.$i"` 每次伪造一个不同的 IP:203.0.113.1、203.0.113.2……这个网段是专门留给文档举例用的,不会是任何真实主机。
- `http://127.0.0.1:8434/api/chat` 第二组经过 Caddy,同样伪造。

</div>

```text
401 401 401 401 401 401 401 401 401 401 401 401 
429 429 429 
```

uvicorn 的访问日志把这件事说得很清楚:

```text
INFO:     203.0.113.10:0 - "POST /api/chat HTTP/1.1" 401 Unauthorized
INFO:     203.0.113.11:0 - "POST /api/chat HTTP/1.1" 401 Unauthorized
INFO:     203.0.113.12:0 - "POST /api/chat HTTP/1.1" 401 Unauthorized
INFO:     127.0.0.1:0 - "POST /api/chat HTTP/1.1" 429 Too Many Requests
INFO:     127.0.0.1:0 - "POST /api/chat HTTP/1.1" 429 Too Many Requests
INFO:     127.0.0.1:0 - "POST /api/chat HTTP/1.1" 429 Too Many Requests
```

直连时,uvicorn 看到请求来自 127.0.0.1(它信任的地址),就照单全收了伪造的头,12 个请求被当成 12 个不同的人,一个都没被限住。经过 Caddy 时,Caddy 默认**不信任**客户端自带的 `X-Forwarded-For`,把它换成了自己看到的真实来源(这里是本机 127.0.0.1),于是这三个请求和前面那 12 个算在同一个桶里,直接 429。

结论有两条,都要落到配置上:

- **应用端口不能对公网开放,只有 Caddy 能连到它。** 一旦 8000 端口能被外面直接访问,限流、审计里的 IP 都可以被伪造。下面的 `compose.yaml` 里 api 服务没有 `ports:`,就是这个原因。
- **在容器里,要告诉 uvicorn 信任 Caddy。** 本机实验里 Caddy 和 uvicorn 都在 127.0.0.1,uvicorn 默认信任它。到了 compose 里,Caddy 是另一个容器,地址是 172.x 这样的内网 IP,uvicorn 默认不信任它,就会把 Caddy 的内网 IP 当成所有用户的 IP,所有人共用一个限流桶,第 11 个访客就被拒。所以线上的启动命令要加 `--forwarded-allow-ips "*"`,前提就是上一条:除了 Caddy 没人连得到它。这一条我本机没法复现(没有 Docker),是按 uvicorn 的文档和上面的实验推出来的。

## 第三步:上服务器要准备的三个文件

服务器那边的步骤 Day 420 到 Day 427 都做过,今天只需要把 Day 432 的服务适配进去。**这一节我没有实跑**:本机没有 Docker,练习环境也不能动站长的云服务器和域名。我做过的验证写在每段后面。

### Dockerfile 加三处

Day 432 的 Dockerfile 只用来过预检,没真正 build 过。真要上线,我对着它把「容器里到底会发生什么」走了一遍,发现有两处会出事:账本库从哪来,审计日志写到哪。

```dockerfile
# agent-zero-lab/Dockerfile(Day 432 的版本加三处,都为了上服务器)
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY part07 ./part07
RUN uv run --no-sync python -m part07.managed.ledger \
    && useradd --create-home app \
    && mkdir /data && chown app /data
USER app
ENV AUDIT_LOG=/data/audit.jsonl
CMD ["uv", "run", "--no-sync", "uvicorn", "part07.service.main:app", "--host", "0.0.0.0", "--port", "8000", "--forwarded-allow-ips", "*"]
```

<div class="line-notes">

- `COPY part07 ./part07` CI 是从 git 仓库构建的,而 Day 432 的 `.gitignore` 忽略了 `*.db`,所以镜像里**没有** `ledger.db`。不处理的话,健康检查一上来就是 503。
- `RUN uv run --no-sync python -m part07.managed.ledger \` 第一处:构建时运行 Day 429 的 `ledger.py`,它的 `setup()` 会在 `part07/managed/` 下生成演示用的账本库。工具用只读模式打开它,所以它放在镜像里、属于 root 也没关系。
- `&& useradd --create-home app \` 和 Day 432 一样建普通用户。`&&` 把三条命令连成一层镜像,前一条失败后面就不跑。
- `&& mkdir /data && chown app /data` 第二处:建一个 app 用户能写的目录。审计日志默认写到 `part07/service/audit.jsonl`,那个目录属于 root,app 用户写不进去。今天故障演练第 6 项会演示写不进审计日志时服务是什么样子。
- `ENV AUDIT_LOG=/data/audit.jsonl` 让审计日志写到 /data。compose 会把一个数据卷挂到这里,容器重建日志也还在。
- `"--forwarded-allow-ips", "*"` 第三处:信任所有来源的转发头。上一步说过,前提是 api 端口不对外。

</div>

做过的验证:改完后 `preflight` 仍然 8/8(检查的是最后一个 `USER` 不是 root);`python -m part07.managed.ledger` 在本机跑过,能生成库。镜像本身没有 build 过。

### compose 和 Caddyfile

```yaml
# agent-zero-lab/compose.yaml(服务器上用)
services:
  api:
    image: ghcr.io/你的GitHub用户名/agent-zero-lab:${IMAGE_TAG:-latest}
    env_file: .env
    volumes:
      - appdata:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    restart: unless-stopped
    depends_on:
      - api

volumes:
  appdata:
  caddydata:
```

<div class="line-notes">

- `image: ghcr.io/你的GitHub用户名/agent-zero-lab:${IMAGE_TAG:-latest}` 和 Day 427 改过的写法一样:服务器不构建,拉 CI 推上去的镜像,`IMAGE_TAG` 是提交哈希。
- `env_file: .env` 把服务器上的 `.env`(模型 key 等)作为环境变量给容器。`.env` 只存在服务器上,权限 600,不进镜像。
- `- appdata:/data` 具名数据卷挂到 /data,审计日志在这里。Docker 第一次创建空卷时会把镜像里 /data 的属主带过来,所以上面 Dockerfile 里的 `chown app /data` 对卷也生效。
- `restart: unless-stopped` 进程崩了自动拉起来,除非你手动 `docker compose stop`。故障演练第 1 项在本机用一个 while 循环模拟它。
- `test: ["CMD", "python", "-c",` python 的 slim 镜像里没有 curl,用 Python 自带的 urllib 敲一下 `/healthz`,返回 503 时 urlopen 会抛异常,退出码非 0,就算不健康。
- `ports:` 注意这个关键字**只出现在 caddy 下面**。api 没有对外端口,只能从 compose 内网被 caddy 访问到。实测用 PyYAML 解析,`api` 的 `ports` 是 `None`,caddy 是 `['80:80', '443:443']`。
- `DOMAIN: ${DOMAIN}` compose 会从同目录 `.env` 里读 `DOMAIN` 的值传给 Caddy 容器,Caddyfile 里用 `{$DOMAIN}` 取。
- `- caddydata:/data` 证书存这里,容器重建不用重新申请(Let's Encrypt 有申请频率限制,反复申请会被暂时拒绝)。

</div>

```text
# agent-zero-lab/deploy/Caddyfile(服务器上用)
{$DOMAIN} {
	reverse_proxy api:8000
}
```

<div class="line-notes">

- `{$DOMAIN} {` `{$变量名}` 是 Caddyfile 读环境变量的写法。站点地址是域名,Caddy 就会自动申请 HTTPS 证书,并把 80 端口的 HTTP 请求跳转到 HTTPS。
- `reverse_proxy api:8000` `api` 是 compose 里的服务名,compose 内网会把它解析成 api 容器的地址。

</div>

做过的验证:用 `DOMAIN=demo.example.com caddy adapt --config deploy/Caddyfile` 把它翻译成 Caddy 的 JSON 配置,结果是监听 `:443`、匹配 host `demo.example.com`、转发到 `api:8000`,说明语法和变量替换都没问题。

### 上线和确认

在服务器上(以 Day 420 建的 `deploy` 用户登录):

```bash
git clone https://github.com/你的GitHub用户名/agent-zero-lab.git && cd agent-zero-lab
nano .env          # 填 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL、LLM_EXTRA_BODY,再加一行 DOMAIN=你的域名
chmod 600 .env
docker compose pull && docker compose up -d
docker compose ps
```

<div class="line-notes">

- `git clone https://github.com/你的GitHub用户名/agent-zero-lab.git && cd agent-zero-lab` 服务器上只需要 compose.yaml 和 deploy/Caddyfile,但整个仓库拉下来,以后 Day 427 的部署脚本 `git pull` 才有地方 pull。
- `nano .env` 用服务器自带的编辑器手工写 `.env`。key 从你本机复制过来,不经过 git。
- `chmod 600 .env` 只有 deploy 用户能读写([Day 424](/blog/agent-zero/day-424-secrets-mgmt/))。
- `docker compose pull && docker compose up -d` 拉镜像、后台启动两个服务。第一次启动 Caddy 会去申请证书,前提是域名的 A 记录已经指向服务器、安全组放行了 80 和 443。
- `docker compose ps` 看两个容器的状态,api 那一行过半分钟应该显示 `healthy`。

</div>

然后回到**你自己的电脑**,对着公网地址跑 Day 432 的两个检查,这才是「公网可访问」的证据:

```bash
cd ~/agent-zero-lab
uv run python part07/smoke.py https://你的域名 C007
uv run python -m part07.smoke_stream https://你的域名 C007
```

<div class="line-notes">

- `uv run python part07/smoke.py https://你的域名 C007` 两个脚本都不在乎对面是本机还是公网,换个地址就行。期望看到 `SMOKE OK`,版本号 0.3.0。
- `uv run python -m part07.smoke_stream https://你的域名 C007` 期望 `STREAM OK`,status 事件在 1 秒内到。这两行我没跑过,上面本机预发的输出是它们应该长的样子。

</div>

最后两件和代码无关、但今天必须做的事:去 DeepSeek 后台设一个月度消费上限(Day 432 清单「成本」组最后一项);把 Day 427 的 `rollback.yml` 在 Actions 页面找到,确认那个 Run workflow 按钮在,出事时你知道去哪点。

## 第四步:故障演练,先写预期

下面七项,每项我都先把「预期」写下来,才动手。建议你也这样:把表格抄到 README 的草稿里,先只填前三列。

| # | 演练 | 怎么弄坏 | 预期 |
| --- | --- | --- | --- |
| 1 | 进程被杀 | 对话进行中 `kill -9` 应用进程 | 这次对话中断;代理返回 502;几秒后自动拉起,健康检查恢复 |
| 2 | 重启后的预算 | 预算设 0.003 元,用完后重启 | 重启后预算清零,又能对话(Day 432 已知限制) |
| 3 | 上游很慢 | 把模型地址指向一个 30 秒才回的假上游 | SDK 每次 2 秒超时,共试 3 次,然后给前端一个可读的错误事件 |
| 4 | 上游 429 | 假上游一律返回 429 | SDK 按 `Retry-After` 重试 2 次,然后错误事件 |
| 5 | 库打不开 | 对话前把 `ledger.db` 挪走 | 健康检查 503;对话时工具报错交给模型,模型向用户道歉 |
| 6 | 审计日志写不进 | `AUDIT_LOG` 指向不存在的目录 | 对话报错事件;健康检查? |
| 7 | 客户端中途断开 | curl 0.5 秒后自己断开,马上再发一条 | 锁被释放,第二条不是 409 |

第 6 项「健康检查?」我写的时候就不确定,照实写上问号。不确定本身也是一种预期:它说明你对这一块没有把握,正是该演练的地方。

### 准备:一个只会慢或只会 429 的假上游

第 3、4 项要让模型 API 出问题。真的 DeepSeek 不会听你的话变慢,所以写一个假的,它长得像 OpenAI 兼容接口,但只会做坏事。和 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的假对象是同一个思路,只不过这次假的是一整个 HTTP 服务。

```python
# agent-zero-lab/part07/drills/fake_llm.py
"""假的模型厂商:只会慢,或者只会 429。用来演练上游出事,不花钱。
用法:FAKE_MODE=slow uv run uvicorn part07.drills.fake_llm:app --port 8999"""
import asyncio
import os
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()
MODE = os.environ.get("FAKE_MODE", "slow")
T0 = time.monotonic()


@app.post("/v1/chat/completions")
async def completions() -> JSONResponse:
    print(f"+{time.monotonic() - T0:5.1f}s 收到一次请求(模式 {MODE})", flush=True)
    if MODE == "429":
        return JSONResponse({"error": {"message": "rate limited", "type": "rate_limit"}},
                            status_code=429, headers={"Retry-After": "1"})
    await asyncio.sleep(30)
    return JSONResponse({"error": {"message": "too late"}}, status_code=500)
```

<div class="line-notes">

- `MODE = os.environ.get("FAKE_MODE", "slow")` 启动时用环境变量选模式,默认 slow。
- `T0 = time.monotonic()` 记下启动时刻,下面打印每次请求到达的相对时间,好看出重试的间隔。
- `@app.post("/v1/chat/completions")` 和 OpenAI 兼容接口同一个路径。我们的服务把 `LLM_BASE_URL` 设成 `http://127.0.0.1:8999/v1`,openai SDK 就会请求到这里。
- `async def completions() -> JSONResponse:` 不读请求体,反正都要失败。
- `print(f"+{time.monotonic() - T0:5.1f}s 收到一次请求(模式 {MODE})", flush=True)` 每来一次打印一行,数这一行出现几次就知道 SDK 重试了几次。`flush=True` 让它立刻出现在终端里,不等缓冲区满。
- `status_code=429, headers={"Retry-After": "1"})` 告诉客户端「1 秒后再来」。
- `await asyncio.sleep(30)` slow 模式:30 秒后才回。我们的 SDK 超时远短于 30 秒,所以它永远等不到这里。

</div>

另外写一个重启应用的小脚本,演练时要反复用不同的环境变量重启:

```bash
# ~/agent-zero-lab 外面随便放,比如 ~/tools/restart_api.sh
cd ~/agent-zero-lab
pkill -f "port 8001"; sleep 1
(env "$@" uv run uvicorn part07.service.main:app --port 8001 > ~/tools/api.log 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8001/healthz && break; sleep 0.5; done
```

<div class="line-notes">

- `pkill -f "port 8001"` 按命令行内容找到并结束旧的应用进程。`-f` 匹配整条命令行,不只是程序名。
- `(env "$@" uv run uvicorn` `"$@"` 是传给这个脚本的所有参数,比如 `LLM_TIMEOUT=2`;`env 变量=值 命令` 让这些变量只对这个命令生效。外面一对括号加 `&` 让它在后台跑,终端不被占住。日志写到 api.log。
- `for i in $(seq 1 30); do curl` 每 0.5 秒敲一次健康检查,通了就停,最多等 15 秒。uv 启动加 import 要几秒,不等的话下一条 curl 会连不上。

</div>

用法是 `bash ~/tools/restart_api.sh LLM_TIMEOUT=2`。Caddy 那个终端一直开着不用动。

### 演练 1:进程被杀

compose 里 `restart: unless-stopped` 的作用,在本机用一个 while 循环模拟:进程退出就等 2 秒再拉起来。

```bash
# ~/tools/supervise.sh:模拟 compose 的 restart: unless-stopped
cd ~/agent-zero-lab
while true; do
  uv run uvicorn part07.service.main:app --port 8001
  echo "$(date +%T) 进程退出了,2 秒后重启"
  sleep 2
done
```

<div class="line-notes">

- `while true; do` 死循环,和 JS 的 `while (true)` 一样。
- `uv run uvicorn part07.service.main:app --port 8001` 前台跑应用。它不退出,循环就停在这一行。
- `echo "$(date +%T) 进程退出了,2 秒后重启"` 应用一退出就走到这里,打印时间。
- `sleep 2` 等 2 秒再进下一轮。真实的进程管理器也会等一下,免得一个启动就崩的程序把 CPU 转满。

</div>

先停掉终端 1 的应用,换成 `bash ~/tools/supervise.sh`。然后在终端 3 里发一个对话,1.2 秒后(模型正在生成回答时)用 `kill -9` 杀掉应用进程:

```bash
(curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C012" -H "content-type: application/json" \
  -d '{"text":"我最近三张发票都付了吗?"}'; echo "curl 退出码 $?") &
sleep 1.2; date +%T
kill -9 $(lsof -ti tcp:8001 -sTCP:LISTEN)
sleep 0.3; curl -s -w " [%{http_code}]\n" $B/healthz
```

<div class="line-notes">

- `(curl -s -N -X POST` 对话放到后台,结束时打印 curl 的退出码。
- `kill -9 $(lsof -ti tcp:8001 -sTCP:LISTEN)` `lsof -ti tcp:8001 -sTCP:LISTEN` 找出正在监听 8001 端口的进程号,`kill -9` 强制结束它,不给它任何收尾的机会。这模拟的是机器内存不足被系统杀掉、或者容器被强制停止。
- `curl -s -w " [%{http_code}]\n" $B/healthz` 进程刚死时,隔着 Caddy 敲健康检查。

</div>

```text
00:01:17
 [502]
event: status
data: {"type": "status", "step": 1}

event: tool
data: {"type": "tool", "name": "my_invoices", "args": {}, "ok": true}

event: status
data: {"type": "status", "step": 2}

curl 退出码 18
```

监工脚本那边打印 `00:01:17 进程退出了,2 秒后重启`,我每 0.5 秒敲一次健康检查,`00:01:23` 恢复 200,前后 6 秒(2 秒等待加上 uv 和 FastAPI 的启动时间)。Caddy 的错误日志里那几秒记的是 `dial tcp 127.0.0.1:8001: connect: connection refused`。

和预期一致:502、自动恢复。但有一个我没写进预期的细节:**流在第 2 步之后就断了,没有 done,也没有 error 事件**,curl 的退出码 18 意思是「传输没完成」。Day 432 一直强调「出错也要给前端一个 error 事件,不要断连」,可进程都被杀了,它没有机会发任何东西。所以这件事只能由**前端**兜:流结束了,却既没收到 done 也没收到 error,就当成失败,显示一句「连接中断,请重试」。练习 2 会让冒烟脚本也学会认这种情况。

### 演练 2:重启以后的预算

```bash
pkill -f supervise.sh; pkill -f "port 8001"
# 把 supervise.sh 里那行改成 DAILY_BUDGET_YUAN=0.003 uv run uvicorn ...,再启动它
```

<div class="line-notes">

- `pkill -f supervise.sh; pkill -f "port 8001"` 先停监工,再停应用,顺序反了监工会马上把应用拉起来。

</div>

预算 0.003 元,而一轮对话约 0.0034 元,所以第一轮能过、第二轮会被拦。连发两次,然后杀进程等它重启,再发一次:

```text
第1次 200
第2次 429
{"detail":"今天的演示额度已用完"}
……kill -9,等健康检查恢复……
重启后 200
```

和预期一致,这是 Day 432 写进已知限制的那一条:预算在进程内存里,重启就清零。演练的价值在于把「已知」变成「亲眼见过」:想象一个刷子发现了规律,每次额度用完就想办法让你的服务崩一次,预算就形同虚设。把它挪到 Redis(Day 383 的 `INCRBYFLOAT`)或数据库,才是真正的修法,这一项我写进 README,今天不修。

### 演练 3 和 4:上游很慢、上游 429

把模型地址指向假上游,超时调成 2 秒方便观察(真实配置是 15 秒),重试次数保持 2:

```bash
FAKE_MODE=slow uv run uvicorn part07.drills.fake_llm:app --port 8999 --log-level warning   # 另开一个终端
bash ~/tools/restart_api.sh LLM_BASE_URL=http://127.0.0.1:8999/v1 LLM_TIMEOUT=2 LLM_MAX_RETRIES=2
time curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" \
  -d '{"text":"我最近三张发票都付了吗?"}'
```

<div class="line-notes">

- `FAKE_MODE=slow uv run uvicorn part07.drills.fake_llm:app --port 8999 --log-level warning` 起假上游。`--log-level warning` 关掉 uvicorn 自己的访问日志,只留我们 print 的那一行。
- `LLM_BASE_URL=http://127.0.0.1:8999/v1 LLM_TIMEOUT=2 LLM_MAX_RETRIES=2` 三个环境变量:地址指向假上游,单次超时 2 秒,最多重试 2 次。key 还是 `.env` 里的真 key,但它只会发给假上游,DeepSeek 收不到任何请求。
- `time curl -s -N` `time` 统计整条命令花了多久。

</div>

```text
event: status
data: {"type": "status", "step": 1}

event: error
data: {"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"}

curl ...  7.466 total
```

假上游那边:

```text
+  4.7s 收到一次请求(模式 slow)
+  7.2s 收到一次请求(模式 slow)
+ 10.0s 收到一次请求(模式 slow)
```

审计日志最后一行是 `{"customer": "C007", "error": "APITimeoutError", ...}`。三次请求,间隔 2.5 秒和 2.8 秒:每次等满 2 秒超时,再加上 SDK 的退避等待(第一次约 0.5 秒,第二次约 0.8 秒),合计 7.5 秒。和预期一致,也正好印证了 Day 432 那条检查:最坏耗时是「超时 × 3 再加退避」,不只是「超时 × 3」。

停掉假上游,换成 429 模式再来一次:

```text
data: {"type": "status", "step": 1}
data: {"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"}
curl ...  2.070 total
+  3.0s 收到一次请求(模式 429)
+  4.0s 收到一次请求(模式 429)
+  5.1s 收到一次请求(模式 429)
```

审计记的是 `RateLimitError`。三次请求间隔正好 1 秒左右,说明 SDK 读了 `Retry-After: 1`,没有自己乱猜等多久。

这两项「对上了」,但我在填「实际」一列时注意到一件不舒服的事:超时、429、Day 432 撞过的 key 失效,前端收到的都是同一个 `code: internal`。用户看到的都是「服务暂时不可用」;更麻烦的是你自己的监控,分不清是「上游忙,过一会儿就好」还是「我们的 key 被吊销了,永远不会好」。前一种不用半夜起来,后一种要。练习 1 把它们分开。

### 演练 5:库打不开。这一项和预期对不上

恢复正常配置重启,然后把账本库挪走,先敲健康检查,再发一次对话:

```bash
bash ~/tools/restart_api.sh
mv part07/managed/ledger.db part07/managed/ledger.db.moved
curl -s -w " [%{http_code}]\n" $B/healthz
curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" \
  -d '{"text":"我最近三张发票都付了吗?"}' | grep data
cat part07/service/audit.jsonl
```

<div class="line-notes">

- `mv part07/managed/ledger.db part07/managed/ledger.db.moved` 改名就等于让它「不见了」,演练完改回来。比删掉安全。
- `| grep data` 只看 `data:` 行,输出短一点。

</div>

```text
{"detail":"ledger db: unable to open database file"} [503]
data: {"type": "status", "step": 1}
data: {"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"}
{"customer": "C007", "error": "OperationalError", "ts": "2026-10-22T23:59:07"}
```

健康检查 503,对得上。对话那部分对不上:我预期的是「工具报错交给模型,模型道歉」,实际是整轮直接崩成 `internal`,审计里也只有一条笼统的 `OperationalError`,没有「是哪个工具、带了什么参数」的记录。

原因在 Day 432 的 `agent.py`。执行工具那一段只接住了 `TypeError`(模型传错参数),而数据库打不开时 sqlite3 抛的是 `OperationalError`,它不是 TypeError,于是一路冒到 `main.py` 最外层的 `except Exception`,整轮作废。而且还有一笔没人记的账:第一次模型调用已经花了钱(模型决定调工具),但这一轮没有走到 done,`spent` 里没加上。

修法是在工具执行那里多接一层。改 `agent.py` 的这一段:

```python
# agent-zero-lab/part07/service/agent.py 里 run_turn 的工具执行部分(改后)
        for c in calls:
            fn = tools.get(c.function.name)
            err: str | None = None
            args = json.loads(c.function.arguments or "{}")
            if fn is None:
                result, ok = f"没有叫 {c.function.name} 的工具。", False
            else:
                try:
                    result, ok = json.dumps(fn(**args), ensure_ascii=False), True
                except TypeError as e:
                    result, ok = f"参数不对:{e}", False
                except Exception as e:  # 库打不开、查询超时:告诉模型查不了,别让整轮崩掉
                    result, ok, err = "系统暂时查不到数据,请稍后再试。", False, type(e).__name__
            audit({"customer": customer_id, "tool": c.function.name, "args": args, "ok": ok, "error": err})
```

<div class="line-notes">

- `err: str | None = None` 每次工具调用先假设没有系统错误。它只进审计,不给模型看。
- `except TypeError as e:` 原来的分支不动:参数错了,把具体的错告诉模型,它能自己改参数再试。
- `except Exception as e:  # 库打不开、查询超时:告诉模型查不了,别让整轮崩掉` 新加的分支。注意顺序:具体的 TypeError 在前,笼统的 Exception 在后,Python 按顺序匹配第一个对得上的。
- `result, ok, err = "系统暂时查不到数据,请稍后再试。", False, type(e).__name__` 给模型的话**不带异常名**,原因下面说;异常名 `OperationalError` 只记进审计。
- `audit({"customer": customer_id, "tool": c.function.name, "args": args, "ok": ok, "error": err})` 审计多一个 `error` 字段,正常时是 `null`。

</div>

我第一版修的时候,给模型的那句话写的是 `f"系统暂时查不到数据({type(e).__name__}),请稍后再试。"`,带着异常名。跑出来模型的回答是:

```text
抱歉，系统暂时查不到数据（接口报错 OperationalError），我这边无法确认您最近三张发票的付款状态。
```

它把 `OperationalError` 原样念给了客户。**工具结果里写了什么,模型就可能一字不差地说给用户听**,所以工具结果要按「这句话可能出现在客户屏幕上」来写,内部细节只进审计。去掉异常名后再跑:

```text
data: {"type": "status", "step": 1}
data: {"type": "tool", "name": "my_profile", "args": {}, "ok": false}
data: {"type": "tool", "name": "my_invoices", "args": {}, "ok": false}
data: {"type": "status", "step": 2}
data: {"type": "message", "text": "抱歉，我这边刚才查询发票时系统返回了“暂时查不到数据”，所以暂时无法确认您最近三张发票的付款状态。\n\n您可以稍后再问我一次，我会立即重试查询；如果一直查不到，建议您稍晚联系人工客服协助核实。为了避免误报，我不会凭猜测告诉您结果。"}
data: {"type": "done", "tokens_in": 806, "tokens_out": 108, "cost": 0.002476}
```

审计里两条工具记录都带着 `"ok": false, "error": "OperationalError"`。这一轮走到了 done,钱也记上了。模型说「我不会凭猜测告诉您结果」,这是我们想要的:查不到就说查不到,不编。演练完记得 `mv part07/managed/ledger.db.moved part07/managed/ledger.db`。

### 演练 6:审计日志写不进。这一项更糟

这一项模拟的是磁盘写满,或者像上面 Dockerfile 那样目录没有写权限。

```bash
bash ~/tools/restart_api.sh AUDIT_LOG=/nonexistent/audit.jsonl
curl -s -w " [%{http_code}]\n" $B/healthz
curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" \
  -d '{"text":"我最近三张发票都付了吗?"}'; echo "curl 退出码 $?"
```

<div class="line-notes">

- `AUDIT_LOG=/nonexistent/audit.jsonl` 一个不存在的目录,打开文件追加时会抛 `FileNotFoundError`。权限不够时是 `PermissionError`,磁盘满时是 `OSError`,它们都是 OSError 家族的。

</div>

```text
{"status":"ok","version":"0.3.0"} [200]
event: status
data: {"type": "status", "step": 1}

curl 退出码 18
```

两处和预期不符,而且比演练 5 更糟:

- **健康检查说「我很好」。** 它只查了库,没查审计日志能不能写。负载均衡器、compose 都会以为这个容器健康,继续把流量转过来,而每一个对话都会失败。
- **流断了,没有 error 事件。** 应用日志里能看到原因:工具执行完要写审计,抛了 `FileNotFoundError`;最外层的 `except Exception` 接住了它,想先**写一条审计**再发 error 事件,于是又抛了一次同样的错。这次没人接了,生成器直接崩掉。处理错误的代码自己出错,是演练里最经典的一类发现。

修两处。健康检查加一项「审计日志能追加」;最外层兜底里写审计这一步自己也要兜住:

```python
# agent-zero-lab/part07/service/main.py 的 healthz(改后)
@app.get("/healthz")
def healthz() -> dict[str, str]:
    try:
        with sqlite3.connect(f"file:{settings.ledger_db}?mode=ro", uri=True) as conn:
            conn.execute("SELECT 1 FROM invoices LIMIT 1")
    except sqlite3.Error as e:
        raise HTTPException(503, f"ledger db: {e}")
    try:
        with open(settings.audit_log, "a", encoding="utf-8"):
            pass
    except OSError as e:
        raise HTTPException(503, f"audit log: {e}")
    return {"status": "ok", "version": VERSION}
```

<div class="line-notes">

- `with open(settings.audit_log, "a", encoding="utf-8"):` 用追加模式打开一下就关,什么都不写。目录不存在、没权限都会在这一步报错。打开再关不会改动文件内容。
- `pass` 什么都不做,Python 要求 `with` 块里至少有一行。
- `raise HTTPException(503, f"audit log: {e}")` 审计写不进就算不健康。这是一个取舍:审计是安全要求(Day 416),写不了审计宁可不服务,也不要「先服务着,日志以后再说」。不需要审计的服务可以不这样做。
- `return {"status": "ok", "version": VERSION}` 仍然不调模型,Day 432 的预检第八项照样能过。

</div>

```python
# main.py 里 stream() 最后那个兜底(改后)
            except Exception as e:  # 模型 401、网络断了……都给前端一个可读的错误事件
                try:
                    audit({"customer": x_demo_customer, "error": type(e).__name__})
                except OSError:
                    print("审计日志写不进去:", type(e).__name__, flush=True)
                yield sse({"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"})
```

<div class="line-notes">

- `except Exception as e:  # 模型 401、网络断了……都给前端一个可读的错误事件` 原来的兜底分支。
- `try:` 写审计这一步单独包起来。兜底代码里调用的任何东西都可能再出错,要么确认它不会,要么也兜住。
- `except OSError:` 只接文件相关的错误。别写成 `except Exception: pass` 把一切都吞掉。
- `print("审计日志写不进去:", type(e).__name__, flush=True)` 审计写不进,至少打到标准输出,容器里会进 `docker compose logs`,不至于什么痕迹都没有。
- `yield sse({"type": "error", "code": "internal",` 不管审计写没写成,都给前端一个 error 事件。

</div>

再跑一次:

```text
{"detail":"audit log: [Errno 2] No such file or directory: '/nonexistent/audit.jsonl'"} [503]
data: {"type": "status", "step": 1}
data: {"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"}
```

应用日志里多了一行 `审计日志写不进去: FileNotFoundError`。健康检查变红,流以 error 事件正常结束。线上真遇到这种情况,compose 会把容器标成 unhealthy,你在 `docker compose ps` 里第一眼就能看到。

### 演练 7:客户端中途断开

用户在模型回答到一半时关掉页面,服务端会不会一直占着锁?恢复正常配置,让 curl 在 0.5 秒时自己放弃,紧接着同一个客户再发一条:

```bash
bash ~/tools/restart_api.sh
curl -s -N --max-time 0.5 -X POST $B/api/chat -H "X-Demo-Customer: C031" \
  -H "content-type: application/json" -d '{"text":"我最近的发票?"}'; echo "curl 退出码 $?"
curl -s -o /dev/null -w "第二条:%{http_code}\n" -X POST $B/api/chat -H "X-Demo-Customer: C031" \
  -H "content-type: application/json" -d '{"text":"我最近的发票?"}'
cat part07/service/audit.jsonl
```

<div class="line-notes">

- `--max-time 0.5` 整个请求最多 0.5 秒,到点 curl 自己断开连接,相当于用户关掉了页面。
- `-o /dev/null -w "第二条:%{http_code}\n"` 第二条完整跑完,只看状态码。

</div>

```text
event: status
data: {"type": "status", "step": 1}

curl 退出码 28
第二条:200
{"customer": "C031", "tool": "my_invoices", "args": {}, "ok": true, "error": null, "ts": "2026-10-23T00:00:04"}
```

curl 退出码 28 是「超时放弃」。第二条是 200,不是 409,说明锁被释放了。审计里只有一条工具记录,是第二条对话的;第一条在模型还没决定调工具时就被取消了,没有继续在后台跑。这是 Day 432 把拿锁写在 `async with lock:` 里、并且把整轮放在 `StreamingResponse` 的生成器里的好处:客户端一断开,Starlette 取消这个生成器,`async with` 保证锁被释放,正在等的模型调用也一起被取消。和预期一致。

### 把「实际」一列填满

| # | 演练 | 预期 | 实际 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | 进程被杀 | 中断、502、自动恢复 | 一致;6 秒恢复;**流断开时没有任何结束事件** | 前端和冒烟脚本把「无 done 无 error」当失败(练习 2) |
| 2 | 重启后的预算 | 清零 | 一致 | 已知限制,写进 README |
| 3 | 上游很慢 | 3 次超时后错误事件 | 一致;7.5 秒,超时之外还有退避 | 错误码不区分原因(练习 1) |
| 4 | 上游 429 | 按 Retry-After 重试 2 次 | 一致;间隔 1 秒 | 同上 |
| 5 | 库打不开 | 模型道歉 | **不一致**:整轮 internal,工具调用没进审计,花的钱没记账 | 已修:工具层接住所有异常;给模型的话不带内部细节 |
| 6 | 审计写不进 | 错误事件 | **不一致**:健康检查 200,流断开无事件 | 已修:健康检查查审计;兜底里写审计也兜住 |
| 7 | 客户端断开 | 锁释放 | 一致;模型调用也被取消 | 无 |

七项里两项对不上,两处修完以后,Day 432 的四个闸门测试、Day 433 的两个慢测试、`preflight` 8/8、`review62` 14/14 全部仍然通过,冒烟仍然 OK。演练一共花了约 0.05 元:真调到 DeepSeek 的是第一步的冒烟和流式检查(0.0034 + 0.0034)、演练 1 和 2 的四五轮(每轮 0.002 到 0.0034)、演练 5 的两次(0.0023、0.0025)、演练 7 的两次,以及最后复查的两次冒烟;演练 3、4 打的是假上游,演练 6 失败在审计,第二步的限流实验全是 401,都没花钱或只花了一次模型调用。

### 写进 README

演练的产出不是一张表,而是 README 里一段具体到数字的「可靠性」说明。我写的是这样:

> 进程被强制结束时,正在进行的对话会中断,前端会收到一个没有 done 的流,显示「连接中断」;进程在约 6 秒内自动重启。上游模型超时或限流时,SDK 最多重试 2 次(单次 15 秒,最坏约 50 秒),之后返回错误事件。账本库或审计日志不可用时,健康检查返回 503;对话中账本库不可用,模型会告知用户暂时查不到,不会编造。已知限制:每日预算、会话锁和限流计数都在进程内存里,重启即清零,多进程部署前要挪到 Redis。

面试时被问「你的系统出了故障会怎样」,能把这一段说出来,并且补一句「这是我亲手演练出来的,其中两项第一次没对上」,比任何形容词都有说服力。

## 动手练习

### 练习 1:把「上游忙」和「我们坏了」分开

演练 3、4 发现超时、429 和 key 失效都是 `code: internal`。请在 `main.py` 的 `stream()` 里,把 openai SDK 的超时、限流、连接错误单独接住,返回 `code: upstream_busy` 和一句「模型服务这会儿有点忙,请过一分钟再试」;key 失效这类仍然是 `internal`。用假上游的 429 模式和一个错误的 key 各验证一次。

<details><summary>参考答案</summary>

```python
# main.py 顶部的 import 改成
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError

# stream() 里,在 except TimeoutError 和 except Exception 之间插入
            except (APITimeoutError, RateLimitError, APIConnectionError) as e:
                audit({"customer": x_demo_customer, "error": type(e).__name__})
                yield sse({"type": "error", "code": "upstream_busy", "text": "模型服务这会儿有点忙,请过一分钟再试。"})
```

<div class="line-notes">

- `from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError` openai SDK 把各种失败都定义成了异常类。`APITimeoutError` 其实是 `APIConnectionError` 的子类,两个都写上是为了读代码的人一眼看懂意图。
- `except (APITimeoutError, RateLimitError, APIConnectionError) as e:` 一个 except 接多种异常,用括号写成元组。它必须放在 `except Exception` **前面**,否则会被那个笼统的分支先接走。
- `audit({"customer": x_demo_customer, "error": type(e).__name__})` 审计照样记下具体是哪种。
- `yield sse({"type": "error", "code": "upstream_busy",` 前端拿到 `upstream_busy` 可以显示「稍后再试」并且自动倒计时重试;监控拿到它可以只记录不报警,`internal` 才报警。

</div>

```bash
FAKE_MODE=429 uv run uvicorn part07.drills.fake_llm:app --port 8999 --log-level warning   # 另一个终端
bash ~/tools/restart_api.sh LLM_BASE_URL=http://127.0.0.1:8999/v1
curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" -d '{"text":"hi"}' | grep data
bash ~/tools/restart_api.sh LLM_API_KEY=sk-wrong
curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" -d '{"text":"hi"}' | grep data
```

<div class="line-notes">

- `bash ~/tools/restart_api.sh LLM_BASE_URL=http://127.0.0.1:8999/v1` 指向 429 模式的假上游。
- `bash ~/tools/restart_api.sh LLM_API_KEY=sk-wrong` 换回真 DeepSeek,但 key 是错的,DeepSeek 会回 401。

</div>

```text
data: {"type": "status", "step": 1}
data: {"type": "error", "code": "upstream_busy", "text": "模型服务这会儿有点忙,请过一分钟再试。"}
data: {"type": "status", "step": 1}
data: {"type": "error", "code": "internal", "text": "服务暂时不可用,请稍后再试。"}
```

审计里分别是 `RateLimitError` 和 `AuthenticationError`。两种情况终于能分开了。

</details>

### 练习 2:让冒烟脚本认出「流断了」

演练 1 发现进程被杀时流会无声断开。用 Day 432 原版的 `smoke.py` 去跑这个场景,会看到什么?请改 `smoke.py`,让它在这种情况下打印清楚的结论,而不是一大段 traceback。

<details><summary>参考答案</summary>

先看原版。冒烟脚本发出请求 1.6 秒后杀掉应用,原版的最后几行输出:

```text
    raise mapped_exc(message) from exc
httpx.RemoteProtocolError: peer closed connection without sending complete message body (incomplete chunked read)
退出码 1
```

退出码是 1,CI 里会变红,这一点没问题;但是一大段 traceback,半夜被叫起来的人要读半天才知道是「服务端在流的中间断了」。改 `main()` 里发请求和判定的那一段:

```python
# agent-zero-lab/part07/smoke.py 的 main() 后半段(改后)
        try:
            with client.stream("POST", f"{base}/api/chat", headers={"X-Demo-Customer": customer},
                               json={"text": "我最近三张发票都付了吗?"}) as r:
                print("chat:", r.status_code)
                for ev in read_events(r):
                    kinds.append(ev["type"])
                    if ev["type"] in ("tool", "done", "error"):
                        print(f"  +{time.monotonic() - t0:.1f}s", ev)
        except httpx.RemoteProtocolError as e:
            print(f"  +{time.monotonic() - t0:.1f}s 连接被对方断开:{e}")
    print("事件序列:", kinds)
    if health.status_code == 200 and kinds[-1:] == ["done"]:
        print("SMOKE OK")
        return 0
    why = "服务返回了 error 事件" if kinds[-1:] == ["error"] else "流在中途断了,既没有 done 也没有 error"
    print(f"SMOKE FAILED:{why}")
    return 1
```

<div class="line-notes">

- `try:` 把整个读流的部分包起来。
- `except httpx.RemoteProtocolError as e:` 对方没把响应发完就关了连接,httpx 抛的就是这个。只接这一种,别的异常(比如连不上)还是让它直接报出来。
- `print(f"  +{time.monotonic() - t0:.1f}s 连接被对方断开:{e}")` 打印在第几秒断的,和前面事件的时间放在一起看。
- `if health.status_code == 200 and kinds[-1:] == ["done"]:` 成功的判定不变。
- `why = "服务返回了 error 事件" if kinds[-1:] == ["error"] else "流在中途断了,既没有 done 也没有 error"` 失败分两种说清楚:服务端好好地告诉了你出错,和服务端根本没说话就没了。前者看审计,后者看进程和代理日志。

</div>

同样的场景再跑一次:

```text
healthz: 200 {'status': 'ok', 'version': '0.3.0'}
chat: 200
  +0.8s {'type': 'tool', 'name': 'my_profile', 'args': {}, 'ok': True}
  +0.8s {'type': 'tool', 'name': 'my_invoices', 'args': {}, 'ok': True}
  +1.2s 连接被对方断开:peer closed connection without sending complete message body (incomplete chunked read)
事件序列: ['status', 'tool', 'tool', 'status']
SMOKE FAILED:流在中途断了,既没有 done 也没有 error
退出码 1
```

等监工把应用拉起来再跑一次正常的,仍然是 `SMOKE OK`。前端读流的代码(第八部分 Day 469 会写)要有同样的逻辑:流结束时检查最后一个事件,不是 done 或 error 就按「连接中断」处理。

</details>

### 练习 3:给你自己的服务做一次故障演练

挑上面七项里的至少四项,外加一项你自己想到的(比如:把 `.env` 里的 `LLM_MODEL` 写成一个不存在的模型名;或者把 `MAX_STEPS` 设成 1)。按「先写预期、再动手」做完,把表格和一段 README 文字写出来。

<details><summary>参考答案</summary>

示范一项我自己加的:`MAX_STEPS=1`。

预期(动手前写的):模型第一步一定会调工具,步数用完,前端收到 `code: max_steps` 的错误事件,说「已经转给人工客服」;这一步的钱没有记账(因为没有 done)。

```bash
bash ~/tools/restart_api.sh MAX_STEPS=1
curl -s -N -X POST $B/api/chat -H "X-Demo-Customer: C007" -H "content-type: application/json" \
  -d '{"text":"我最近三张发票都付了吗?"}' | grep data
```

<div class="line-notes">

- `bash ~/tools/restart_api.sh MAX_STEPS=1` Agent 循环只允许一步。Day 432 的 `run_turn` 在步数用完时 yield 一个 max_steps 错误事件。

</div>

```text
data: {"type": "status", "step": 1}
data: {"type": "tool", "name": "my_invoices", "args": {}, "ok": true}
data: {"type": "error", "code": "max_steps", "text": "这个问题我查了几步还没查清,已经转给人工客服。"}
```

和预期一致,也再一次说明了演练 5 里那个账的问题:步数用完、超时、上游失败这几种结局都没有 done,前面已经花掉的 token 不进 `spent`。要修,得让 `run_turn` 在每一步后都报告 token(比如每步产出一个 usage 事件),`main.py` 收到就记账,而不是只在 done 时记。这一条我写进了 README 的已知限制。

README 段落参考正文「写进 README」那一段,再补一句:「单轮最多 5 步,用完时给用户转人工提示;失败轮次已消耗的 token 目前不计入每日预算。」

</details>

**验收标准**:本机预发上 `smoke.py` 和 `smoke_stream.py` 都 OK;限流实验能复现「直连可伪造、经过 Caddy 不可伪造」;部署的三个文件写好,`caddy adapt` 和 PyYAML 解析通过(有服务器的,公网地址冒烟 OK);演练表至少五项填满「实际」,对不上的修好或写进 README;修完后 `pytest`、`preflight`、`review62` 全绿。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 预发(staging) | 和生产结构一样、但不对外的环境,上线前在这里先跑一遍;今天是本机的 Caddy + uvicorn |
| 限流(rate limiting) | 限制同一来源在一段时间内的请求数,超了直接拒绝,通常返回 429 和 Retry-After |
| 滑动窗口 | 一种限流算法:记住最近一段时间里每次请求的时刻,数窗口内有几次,而不是按整分钟清零 |
| X-Forwarded-For | 代理转发请求时写入的请求头,记录原始客户端 IP;客户端自己也能写,所以只能信任自己的代理写的那一份 |
| 故障演练(game day) | 在可控的时间故意制造故障,先写预期再动手,对比实际,找出 bug 和理解偏差 |
| 假上游 | 模仿真实外部服务接口、但只会返回你指定的坏结果的小服务,用来演练依赖出问题 |
| 进程守护 | 进程退出后自动重新拉起它的机制,compose 的 `restart:`、systemd 的 `Restart=` 都是 |
| Retry-After | 标准响应头,告诉客户端多少秒后再试,429 和 503 常带 |

## 常见误区

**故障演练不写预期,直接动手。** 不写预期,演练 5 那个「整轮崩掉」我大概会觉得「数据库都没了,报错很合理」,就放过去了。是因为我事先写了「模型道歉」,才意识到这里有 bug。

**应用端口和代理端口都对公网开放。** 今天实测,直连 uvicorn 时伪造 `X-Forwarded-For` 就能每次换一个 IP,限流形同虚设,审计里的 IP 也全是假的。compose 里只有代理有 `ports:`。

**容器里不配 `--forwarded-allow-ips`。** uvicorn 只信任 127.0.0.1 来的转发头,而 Caddy 容器的地址不是它。结果所有用户都被当成 Caddy 的内网 IP,共用一个限流桶,第 11 个访客就被拒。

**健康检查只查数据库。** 演练 6 里审计日志写不进,健康检查却一直 200,每个对话都失败。健康检查要覆盖「服务能不能完成一次正常请求」所需的、你自己能控制的每一样东西:库、要写的文件、磁盘空间,但仍然不调模型。

**兜底的 except 里随手调可能出错的函数。** 演练 6 的流断掉,就是因为兜底分支里写审计又抛了同样的错。兜底代码要么只做不会失败的事,要么自己也包一层。

**工具报错原样交给模型。** 模型会把 `OperationalError` 念给客户听。给模型的话按「会出现在客户屏幕上」来写,内部细节只进审计。

**Dockerfile 只拿来过检查,从没想过容器里会发生什么。** Day 432 的 Dockerfile 能过预检,但真跑起来,镜像里没有 `ledger.db`(被 `.gitignore` 挡在 git 外面),app 用户也写不进审计日志目录。没有 Docker 的时候,至少对着每一行问一句「这时候文件在哪、属于谁」。

**以为限流能挡住花钱。** 限流挡的是「一个人用光所有人的额度」,挡不住很多人一起来。总花费还是靠每日预算和厂商后台的月度上限,三样一起才完整。

## 学习资料

### 文档与文章

- [Caddy · reverse_proxy 指令](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy):看「Headers」一节,确认它默认怎么设置 `X-Forwarded-For`、什么时候才信任客户端带来的值(`trusted_proxies`);再看 `flush_interval`,SSE 为什么不需要配置。20 分钟。
- [Uvicorn · Settings](https://uvicorn.dev/settings/):找 `--proxy-headers` 和 `--forwarded-allow-ips`,今天第二步的依据。10 分钟。
- [Google SRE Book · Testing for Reliability](https://sre.google/sre-book/testing-reliability/):Day 432 推荐过的那本书的这一章,讲在生产里测试可靠性的各种方法,今天的演练是其中最朴素的一种。40 分钟。
- [Principles of Chaos Engineering](https://principlesofchaos.org/):混沌工程的原则,一页纸。它比今天的演练更进一步:在生产环境、持续地、自动地注入故障。先知道有这条路就行。10 分钟。
- [MDN · Retry-After](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Retry-After):前端视角的说明,和今天限流返回的头、假上游的 429 是同一个东西。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z5w6ekE1L&autoplay=0&high_quality=1" title="全自动HTTPS加密，开箱即用，Caddy基础入门，反向代理，负载均衡，网站托管全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · Caddy 基础入门,反向代理、负载均衡、网站托管全流程 · 11 分钟,6 万多播放。第一步和第三步的 Caddyfile 都很短,看他演示一遍自动 HTTPS 和反向代理,上服务器前心里有底。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BH4y1g7ad&autoplay=0&high_quality=1" title="动画学Redis分布式限流算法，面试必考，令牌桶、漏桶、计数器、滑动窗口你学会了吗？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>熊老板i · 动画学限流算法:令牌桶、漏桶、计数器、滑动窗口 · 10 分钟。今天用的是滑动窗口,看完动画能说出它和另外三种的区别,面试常问。视频里用 Redis 做分布式版本,正好是我们「挪到 Redis」那条已知限制的样子。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t44y1a7JA&autoplay=0&high_quality=1" title="从0开始混沌工程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RanCoder · 从 0 开始混沌工程 · 37 分钟。讲混沌工程的来历和做法。今天的故障演练是手工版的,这个视频讲公司里怎么把它变成工具和流程,挑前 15 分钟看概念即可。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1M3m4EwtXb4" title="GameDays: Practice Thoughtful Chaos Engineering • Ho Ming Li • GOTO 2018" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GOTO Conferences · GameDays: Practice Thoughtful Chaos Engineering · 英文。AWS 的工程师讲怎么组织一次 game day:谁参加、先假设什么、怎么控制影响范围、事后怎么复盘。和今天「先写预期」那条规矩是一回事。</figcaption>
</figure>

### 书籍

- Betsy Beyer 等《Site Reliability Engineering》(O'Reilly, 2016,[官网免费在线读](https://sre.google/sre-book/table-of-contents/)):Day 432 推荐过,今天读「Managing Incidents」和「Postmortem Culture」两章,演练出问题后怎么写复盘。中文版《SRE:Google 运维解密》(电子工业出版社)。1.5 小时。
- Casey Rosenthal、Nora Jones《Chaos Engineering: System Resiliency in Practice》(O'Reilly, 2020):混沌工程的系统介绍,作者来自 Netflix。今天只需要读第 1 章,知道演练做到极致是什么样。

### 开源项目与代码

- [caddyserver/caddy](https://github.com/caddyserver/caddy):今天用的 v2.11.7 就从这里的 Releases 下载。
- [Netflix/chaosmonkey](https://github.com/Netflix/chaosmonkey):「随机杀掉生产环境里的实例」这个想法的源头,看 README 了解它在做什么就够了,今天的演练 1 是它的手工版。

## 自测

1. 故障演练为什么一定要「先写预期再动手」?举今天的一个例子。

<details><summary>答案</summary>

不写预期,任何结果事后看都显得合理,发现不了问题。演练 5 我预期「工具报错交给模型、模型道歉」,实际整轮崩成 internal,这个落差才让我去查,找到了 `agent.py` 只接 `TypeError` 的 bug,顺带发现失败轮次的钱没记账。如果没写预期,「数据库都没了,报个错」看起来完全正常。

</details>

2. 为什么直连 uvicorn 时伪造 `X-Forwarded-For` 能绕过限流,经过 Caddy 就不行?线上该怎么配?

<details><summary>答案</summary>

uvicorn 默认信任来自 127.0.0.1 的转发头,直连时请求就来自 127.0.0.1,于是它用伪造的头当客户端 IP。Caddy 默认不信任客户端自带的 `X-Forwarded-For`,会换成它自己看到的真实来源再转发。线上要做两件事:api 端口不对公网开放,只有 Caddy 能连;uvicorn 加 `--forwarded-allow-ips "*"` 信任 Caddy 写的头(因为容器里 Caddy 不是 127.0.0.1)。两条缺一不可:只做第二条不做第一条,任何人都能伪造。

</details>

3. 演练 6 里流为什么会无声断开?你从中学到写兜底代码的什么原则?

<details><summary>答案</summary>

工具执行后写审计抛了 `FileNotFoundError`,被最外层 `except Exception` 接住;兜底分支在发 error 事件前又去写审计,再抛一次同样的错,这次没有人接,生成器崩掉,连 error 事件都没发出去。原则是:兜底代码里调用的东西也可能失败,要么只做不会失败的事,要么自己再包一层,并且最后一定要把给用户的那个 error 事件发出去。

</details>

4. 演练 3 里单次超时 2 秒、重试 2 次,总共却花了 7.5 秒。多出来的 1.5 秒是什么?这对 Day 432 的超时检查意味着什么?

<details><summary>答案</summary>

是 SDK 在两次重试之间的退避等待,实测第一次约 0.5 秒、第二次约 0.8 秒。意味着 Day 432 预检里「超时 × (重试 + 1) 要短于单轮超时」是一个偏乐观的估计,真正的最坏情况还要加上退避。线上配置 15 秒 × 3 = 45 秒,加退避约 47 秒,仍短于 60 秒,所以没问题;但如果把单次超时调到 19 秒,纸面上 57 秒能过检查,实际就会超。

</details>

5. **面试题**:「你的 Agent demo 部署在公网上,怎么防止被人刷爆?」

<details><summary>答案</summary>

分三层。第一层限流:按 IP 每分钟 10 次,放在所有检查最前面,返回 429 和 Retry-After;应用端口不对外,只有 Caddy 能访问,uvicorn 只信任 Caddy 写的 `X-Forwarded-For`,我实测过直连时伪造这个头能绕过,所以这条很关键。第二层花钱的上限:服务每日预算,超了返回 429;单轮最多 5 步;模型厂商后台设月度消费上限,这是代码挂了也有效的最后一道。第三层减少可攻击面:不开放注册,只有固定演示账号;消息长度上限 500 字。然后补已知限制:限流和预算都在进程内存里,重启清零,我在故障演练里亲眼验证过,要做多进程或更严格的防护得挪到 Redis。

</details>

## 明天预告

明天是 Day 435 · 开题:为什么做智能客服工单,第八部分毕业项目 SupportPilot 的第一天。第七部分到今天结束,你手里有一个上了公网、做过演练的小服务,但它只有两个只读工具、一个循环,撑不起一次面试。接下来 60 多天做一个完整的、像真产品的东西。明天不写代码,先回答一个很多人跳过的问题:作品项目该怎么选题,为什么是客服工单,而不是 AI 写周报或者旅行规划。
