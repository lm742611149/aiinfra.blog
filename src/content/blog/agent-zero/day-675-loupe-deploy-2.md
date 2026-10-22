---
title: 'Day 675 · Loupe(二十一):部署前后端,性能表,上线清单'
description: '把 Agent Loupe 搬到网上:先在本机按线上的样子彩排一遍,前端构建后交给 Cloudflare Pages(用 wrangler 在本机验证 SPA 回退,顺手抓到一条会被静默忽略的 _redirects 规则),后端给 Fly.io 和自己的云服务器两条路线;再用脚本量出步骤接口的真实耗时,最后把上线清单里能自动化的八项写成 smoke.py。'
pubDate: 2026-10-22
regime: none
tags: ['agent-loupe', 'deploy', 'cloudflare-pages', 'fly-io', 'python', 'agent-zero']
series: 'agent-zero'
day: 675
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 674](/blog/agent-zero/day-674-loupe-deploy-1/) 给演示站装了三道闸:哪些接口开放、哪些只读、哪些关掉;样例脱敏加残留扫描;`guard.py` 里按 IP 和全站的滑动窗口限流、按当天实际花费的每日上限、只信任确定存在的那层代理的 `client_ip`,以及被拒绝时自己补上的 CORS 头。那一课所有东西都在本机测试里跑,`TestClient` 假装是浏览器。

今天把这些东西真正放到网上。前面四周做的时间轴、对比、重跑、评测用例,如果招聘方点开链接看到的是一个白屏,就等于没做。部署这件事本身不难,难的是线上和本机有几处不一样,而这几处不一样恰好会让昨天的保护失效。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚「部署前端」和「部署后端」分别是在做什么:前端是把 `dist/` 里的静态文件交给一个托管服务,后端是让一个进程一直开着、并且有一块重启不丢的磁盘。
2. 在本机用和线上相同的环境变量彩排一遍:后端用启动脚本起来,前端构建后用 wrangler 模拟 Cloudflare Pages,深层链接能打开。
3. 写出 Fly.io 和自己云服务器两套后端配置,知道各自哪一行决定了「只有一个进程」和「数据不丢」,并用脚本检查配置文件。
4. 用脚本量出步骤接口的真实耗时填进性能表,把上线清单里能自动化的项目写成 `smoke.py` 跑通。

预计用时 3 小时。本机彩排约 1.5 小时;真部署到 Fly.io 或服务器另算,排查网络问题可能再要一两个小时。

前置:[Day 674](/blog/agent-zero/day-674-loupe-deploy-1/)(guard、seed_demo、CORS)、[Day 663](/blog/agent-zero/day-663-loupe-perf/)(一万步合成样例和前端测量方法)、[Day 660](/blog/agent-zero/day-660-loupe-steps/)(步骤接口和价格表)、[Day 421](/blog/agent-zero/day-421-linux-2/)(systemd)、[Day 422](/blog/agent-zero/day-422-dockerfile-prod/)(Dockerfile)、[Day 425](/blog/agent-zero/day-425-deploy-route/)(部署路线和 HTTPS)、[Day 432](/blog/agent-zero/day-432-prod-project-1/)(上线检查清单)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `start.sh` 和 `smoke.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 部署到底在部署什么

先从你熟悉的那一侧讲。你写 React 时,`pnpm build` 会在 `dist/` 下生成一个 `index.html` 和几个带哈希的 `.js`、`.css` 文件。浏览器打开网站,就是把这几个文件下载下来执行。这些文件放在哪都行:一台 Nginx、一个对象存储、或者 Cloudflare Pages 这种「静态托管」服务。静态托管的意思是它只负责把文件原样发出去,不运行你的任何 Python 代码。它便宜、全球都有节点、不用管服务器,所以前端几乎都放这类服务上。

后端不一样。Loupe 的后端是一个 FastAPI 进程,每次请求都要执行 Python 代码、读写 `loupe.db` 这个 SQLite 文件,重跑时还要去调模型。所以后端需要三样东西:一台一直开着的机器(或者一个会按需启动的容器)、一个能被外网访问的地址加 HTTPS、一块重启以后还在的磁盘。

这两部分分开部署以后,前端在 `loupe.你的域名`,后端在 `api.loupe.你的域名`(或者 Fly 给的 `xxx.fly.dev`)。浏览器里看,这就是你在 DevTools 网络面板里见过的跨域请求:页面从一个域名加载,`fetch` 发到另一个域名。Day 674 配的 CORS 就是为这一刻准备的。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="Loupe 的部署结构:构建时 VITE_API_BASE 被写进前端 JS,前端放 Cloudflare Pages;后端是一个进程加一块持久盘,前面一层代理;只有重跑会调模型">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="110" width="96" height="44" fill="none" stroke="var(--ink-soft)"/>
    <text x="64" y="136" text-anchor="middle" fill="var(--ink)">访客浏览器</text>
    <rect x="150" y="24" width="170" height="60" fill="none" stroke="var(--ink-soft)"/>
    <text x="235" y="44" text-anchor="middle" fill="var(--ink)">Cloudflare Pages</text>
    <text x="235" y="60" text-anchor="middle" fill="var(--ink-faint)">dist/ 静态文件</text>
    <text x="235" y="76" text-anchor="middle" fill="var(--ink-faint)">JS 里写死了后端地址</text>
    <rect x="150" y="170" width="170" height="60" fill="none" stroke="var(--ink-soft)"/>
    <text x="235" y="190" text-anchor="middle" fill="var(--ink)">代理</text>
    <text x="235" y="206" text-anchor="middle" fill="var(--ink-faint)">Fly 边缘 或 Caddy</text>
    <text x="235" y="222" text-anchor="middle" fill="var(--ink-faint)">负责 HTTPS</text>
    <rect x="350" y="150" width="160" height="100" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="430" y="170" text-anchor="middle" fill="var(--compute)">uvicorn 只一个进程</text>
    <text x="362" y="190" fill="var(--ink-soft)">guard:只读/花费/限流</text>
    <text x="362" y="208" fill="var(--ink-soft)">路由</text>
    <text x="362" y="226" fill="var(--ink-soft)">loupe.db 在持久盘</text>
    <rect x="534" y="176" width="92" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="580" y="202" text-anchor="middle" fill="var(--mem)">模型 API</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="112" y1="122" x2="150" y2="60"/>
    <line x1="112" y1="142" x2="150" y2="200"/>
    <line x1="320" y1="200" x2="350" y2="200"/>
    <line x1="510" y1="198" x2="534" y2="198" stroke="var(--mem)"/>
  </g>
  <text x="340" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">① 下载页面  ② fetch 跨域到后端</text>
  <text x="340" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">key 只在后端,前端里一个都没有</text>
</svg>
<figcaption>今天要搭起来的结构。左上是前端那一侧,左下到右是后端那一侧。两边各自部署,靠 CORS 和构建时写进 JS 的后端地址接上。</figcaption>
</figure>

后端有两条硬约束,今天会反复出现,先记住:

- **只能有一个进程**。Day 674 的限流计数存在进程内存里(`SlidingWindow.hits` 是个 dict),两个进程就是两份计数。SQLite 也不适合多个进程同时写。
- **磁盘要持久**。`loupe.db` 存着样例和访客的重跑记录,重启后要还在;样例也不能每次重启都重复导入一遍。

## 第一步:本机彩排

我的习惯是先在本机按线上的样子跑一遍,把「配置写错」这类问题在本机暴露,再上真服务器。本机彩排和线上唯一的区别应该只是地址和路径。

今天的代码都放在 `agent-loupe/` 仓库里,它是 Day 652 起一路建起来的。本文实跑用的是一份精简副本,只保留了今天用到的部分(`db.py`、`guard.py`、`pricing.py`、`seed_demo.py`、步骤接口),目录、文件名、环境变量和 Day 674 一致。

先写一份彩排用的环境变量文件。环境变量你在前端也见过,`.env` 里写 `VITE_XXX=...`,Vite 构建时读。后端也一样,只是读的是 Python 的 `os.environ`:

```bash
# agent-loupe/deploy/rehearsal.env  本机彩排用:和线上一样的变量,只是地址和路径换成本机
LOUPE_DB=../deploy/rehearsal/loupe.db
LOUPE_DEMO=1
TRUST_PROXY=
DAILY_BUDGET_USD=0.5
REPLAY_PER_IP_PER_HOUR=5
LOUPE_CORS=http://localhost:4183
LOUPE_SAMPLES=../samples
LOUPE_ADMIN_TOKEN=rehearsal-admin
```

<div class="line-notes">

- `LOUPE_DB=../deploy/rehearsal/loupe.db` 数据库文件放在一个单独的目录里,彩排完整个删掉就是干净的初始状态。路径相对于 `server/`,因为我们在 `server/` 里启动。
- `LOUPE_DEMO=1` 打开 Day 674 的演示模式,guard 中间件开始拦写操作。彩排一定要开,否则你测的是另一个程序。
- `TRUST_PROXY=` 留空表示「前面没有代理,谁的头都不信」。本机彩排时 curl 直连 uvicorn,确实没有代理,所以就该是空的。上线后改成 `fly` 或 `xff`。
- `DAILY_BUDGET_USD=0.5` 每天花费上限 0.5 美元,和线上一样。
- `REPLAY_PER_IP_PER_HOUR=5` 每个 IP 每小时 5 次重跑,smoke.py 会验证第 6 次被拦。
- `LOUPE_CORS=http://localhost:4183` 前端在本机的地址。等会儿 wrangler 跑在 4183 端口,所以写这个;线上换成 `https://loupe.你的域名`。
- `LOUPE_SAMPLES=../samples` 启动时从这里导入脱敏样例。
- `LOUPE_ADMIN_TOKEN=rehearsal-admin` 管理员 token,只有带着它才能在演示模式下导入。彩排要导入一万步的压测样例,所以要它;线上用 `fly secrets set` 设一个长随机串。

</div>

再写一个启动脚本。线上不管是 Fly 还是 systemd,最后执行的都是这一个文件,这样两条路线的启动行为完全一样:

```bash
#!/bin/sh
# agent-loupe/server/scripts/start.sh  线上启动入口:先导入样例(库里有数据就跳过),再起唯一的那个进程
set -e
python -m scripts.seed_demo "${LOUPE_SAMPLES:-../samples}"
exec uvicorn loupe.app:create_app --factory --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}" --workers 1 --no-proxy-headers
```

<div class="line-notes">

- `#!/bin/sh` 第一行叫 shebang,告诉系统用 `/bin/sh` 执行这个文件。我们用 `sh scripts/start.sh` 调用时它不起作用,但写上是好习惯。
- `set -e` 任何一条命令失败就立刻退出。没有它的话,`seed_demo` 报错了脚本还会继续起 uvicorn,你会得到一个空库的演示站。
- `python -m scripts.seed_demo` 这是 Day 674 写的样例导入脚本:库里已经有数据就打印「库里已经有数据,跳过」并退出,否则导入 `samples/` 下小于 5 MB 的 `.jsonl`。`-m` 表示按包路径找文件来运行(`scripts/seed_demo.py`)。后面的 `"${LOUPE_SAMPLES:-../samples}"` 是 shell 的默认值语法:变量有值就用它,没有就用 `../samples`,相当于 JS 的 `process.env.LOUPE_SAMPLES ?? '../samples'`。
- `exec uvicorn` 这一行参数多,一个个说。<br>`exec` 让 uvicorn 替换掉当前的 shell 进程,而不是作为它的子进程,这样 systemd 或 Fly 发的停止信号直接送到 uvicorn,能正常关闭。<br>`--factory`:`loupe.app:create_app` 是一个返回 app 的函数,不是 app 对象本身,这个参数告诉 uvicorn 先调用它。<br>`--host "${HOST:-127.0.0.1}"` 默认只监听本机。自己服务器上前面有 Caddy,只监听 127.0.0.1 外网就碰不到它;Fly 上要设 `HOST=0.0.0.0`,因为 Fly 的代理从容器外面连进来。<br>`--workers 1` 只起一个进程,原因前面说过,等会儿演示写成 2 会怎样。<br>`--no-proxy-headers` 关掉 uvicorn 自己对 `X-Forwarded-For` 的处理,IP 由 Day 674 的 `client_ip` 一个人说了算。这个参数是我彩排时才加上的,下面专门讲。

</div>

### 故意制造一次:价格表是空的

Day 674 说过,演示模式下价格表为空要拒绝启动,否则每日花费永远算成 0,上限形同虚设。上线前先确认这条保护真的生效。`deploy/empty-prices.json` 里只有一个 `{}`:

```bash
cd agent-loupe/server
set -a; . ../deploy/rehearsal.env; set +a
LOUPE_PRICES=../deploy/empty-prices.json uv run sh scripts/start.sh
```

<div class="line-notes">

- `cd agent-loupe/server` 后面所有相对路径都以 `server/` 为起点。
- `set -a; . ../deploy/rehearsal.env; set +a` `set -a` 让之后定义的变量都自动 `export`,`.` 是「在当前 shell 里执行这个文件」,于是文件里的每一行都变成了环境变量;`set +a` 关掉自动导出。效果相当于前端的 `dotenv`。
- `LOUPE_PRICES=../deploy/empty-prices.json` 写在命令前面的变量只对这一条命令生效。Day 660 的 `load_prices` 读这个变量找价格表。

</div>

真实输出(截掉中间的调用栈):

```text
导入 weather_demo.jsonl demo-weather 12 步
Traceback (most recent call last):
  File ".../server/.venv/bin/uvicorn", line 12, in <module>
    sys.exit(main())
  ...
  File ".../server/loupe/app.py", line 46, in create_app
    guard.install(app, conn)
  File ".../server/loupe/guard.py", line 81, in install
    raise RuntimeError("演示模式必须有可用的 prices.json,否则每日花费上限不生效")
RuntimeError: 演示模式必须有可用的 prices.json,否则每日花费上限不生效
```

注意第一行:样例先导入成功了,然后 `create_app` 才失败。所以这次失败不是「什么都没发生」,库里已经有了一条运行。下一次正常启动时 `seed_demo` 会说「库里已经有数据,跳过」。这没问题,但你要知道它发生了。我在这一步之后把 `deploy/rehearsal/loupe.db` 删掉,从干净状态重新开始。

价格表我按 2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing) 查到的 `deepseek-flash` 高峰价填(每百万 token 输入 0.3 美元、输出 1.2 美元;非高峰是一半),取高的那个,上限只会更早触发,不会更晚:

```json
{"deepseek-flash": {"input": 0.3, "output": 1.2}}
```

### 正常启动,导入一万步样例

```bash
cd agent-loupe/server
set -a; . ../deploy/rehearsal.env; set +a
uv run sh scripts/start.sh
```

```text
导入 weather_demo.jsonl demo-weather 12 步
INFO:     Started server process [15775]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

`synthetic_10k.jsonl` 有 10 MB,超过 5 MB 被 `seed_demo` 跳过了,这是故意的:压测样例不放进演示站。但测性能要用它,所以在另一个终端用管理员 token 导入:

```bash
curl -s localhost:8000/api/health
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -X POST \
  -H "authorization: Bearer rehearsal-admin" \
  --data-binary @../samples/synthetic_10k.jsonl localhost:8000/api/import
curl -s localhost:8000/api/health
```

<div class="line-notes">

- `curl -s localhost:8000/api/health` 健康检查接口,返回进程号和库里有几条运行。线上的探活、smoke.py 第一项都用它。
- `-o /dev/null -w "%{http_code} %{time_total}s\n"` 不打印响应体,只打印状态码和总耗时。`-w` 是 curl 的输出模板。
- `-H "authorization: Bearer rehearsal-admin"` 带上管理员 token,guard 看到它就放行,不然演示模式下导入是 403。
- `--data-binary @../samples/synthetic_10k.jsonl` `@` 表示从文件读请求体,`--data-binary` 保证换行原样发送。JSONL 一行一条记录,换行被吃掉就解析不了。

</div>

```text
{"ok":true,"pid":15775,"runs":1}
200 1.949991s
{"ok":true,"pid":15775,"runs":2}
```

导入一万步花了约 1.95 秒,库里从 1 条变成 2 条。到这里后端在本机已经是「线上的样子」了。

## 第二步:构建前端,看看后端地址去了哪

Day 674 在 `api.ts` 里加了 `API_BASE`,构建时从 `VITE_API_BASE` 读。这里有个前端同学容易想当然的地方:`import.meta.env.VITE_API_BASE` 不是运行时读的,它在构建时被**文字替换**成了字符串。我们亲眼看一下:

```bash
cd agent-loupe/web
VITE_API_BASE=http://localhost:8000 npx vite build
grep -o "http://localhost:8000" dist/assets/*.js
```

<div class="line-notes">

- `VITE_API_BASE=http://localhost:8000 npx vite build` 只对这一次构建设置变量。线上构建时在 Cloudflare Pages 的环境变量里设成后端的公网地址。本机没装 pnpm,这里用 `npx vite build`,效果和 `pnpm build` 一样(精简副本的 build 脚本就是 `vite build`;完整仓库里还有 Day 661 加的 `tsc --noEmit`)。
- `grep -o "http://localhost:8000" dist/assets/*.js` 在打包产物里搜这个地址,`-o` 只打印匹配到的部分。

</div>

```text
dist/index.html                0.21 kB │ gzip: 0.18 kB
dist/assets/index-CgtOdTH2.js  0.97 kB │ gzip: 0.58 kB

✓ built in 211ms
http://localhost:8000
http://localhost:8000
```

地址被原样写进了 JS 文件。这带来两个推论。第一,换后端地址必须**重新构建**前端,改 Pages 的环境变量后不重新部署是没用的。第二,`VITE_` 开头的变量任何访客都能在浏览器里看到,所以只能放公开的东西,永远不放 key。上线清单最后有一项专门扫前端产物里有没有 `sk-`。

## 第三步:Cloudflare Pages,先在本机模拟

Cloudflare 官方的命令行工具 wrangler 能在本机模拟 Pages 的行为,包括 `_redirects` 规则和找不到文件时怎么办。不用注册账号就能跑。我用的是 2026 年 10 月查到的最新版 4.151.3:

```bash
cd agent-loupe/web
npm i -D wrangler@4.151.3
npm install-scripts approve workerd
npm rebuild workerd
npx wrangler pages dev dist --port 4183
```

<div class="line-notes">

- `npm i -D wrangler@4.151.3` 装成开发依赖,锁定版本号。
- `npm install-scripts approve workerd` 这一行是我第一次装完跑不起来才加的。本机的 npm 11.19 默认不执行依赖包的安装脚本,装完会提示 `workerd@1.20261019.1 (postinstall: node install.js)` 没执行。workerd 是 Cloudflare 的运行时,它的安装脚本要下载本机对应的二进制文件,不执行就跑不了。这条命令把它加进允许名单。
- `npm rebuild workerd` 允许以后补跑一次它的安装脚本,输出 `rebuilt dependencies successfully`。
- `npx wrangler pages dev dist --port 4183` 把 `dist/` 当成一个 Pages 站点在本机 4183 端口起起来。我第一次用的是 4173,报了 `Address already in use (localhost:4173)`,本机别的程序占着,换个端口就行,记得 `rehearsal.env` 里的 `LOUPE_CORS` 跟着改。

</div>

### 深层链接:一条会被静默忽略的规则

前端是单页应用(SPA):只有一个 `index.html`,`/diff`、`/runs/xxx` 这些路径都是 React Router 在浏览器里处理的,服务器上并没有叫 `diff` 的文件。访客直接打开 `https://loupe.你的域名/diff?a=...&b=...`,静态托管要是老老实实去找 `diff` 这个文件,找不到就是 404。

网上流传最广的写法是在 `public/_redirects` 里写一行 `/*    /index.html   200`,意思是「所有路径都返回 index.html,状态码 200」。我一开始也是这么写的,彩排时 wrangler 的启动日志里冒出这么一段:

```text
✨ Parsed 0 valid redirect rules.
▲ [WARNING] Found 1 invalid redirect rule:
  ▶︎ Infinite loop detected in this rule and has been ignored. This will cause a redirect to strip `.html` or `/index` and end up triggering this rule again. Please fix or remove this rule to silence this warning.
      at dist/_redirects:1 | /*    /index.html   200
```

规则被判定为死循环并**忽略**了。原因是 Pages 会把 `/index.html` 自动重定向到 `/`(去掉 `.html` 和 `/index`),于是 `/index.html` 又匹配到 `/*`,绕回来。但奇怪的是深层链接照样能打开,状态码 200。这是为什么?

我做了个小实验。把 `_redirects` 删掉,分别在「没有 404.html」和「有 404.html」两种情况下打开深层链接:

```bash
curl -s -o /dev/null -w "no _redirects: %{http_code}\n" "http://localhost:4184/diff?a=x&b=y"
echo '<h1>nf</h1>' > ../../noredir/404.html
curl -s -o /dev/null -w "with 404.html: %{http_code}\n" "http://localhost:4184/diff?a=x&b=y"
```

<div class="line-notes">

- `"http://localhost:4184/diff?a=x&b=y"` 网址要用引号包起来。我第一次没加引号,zsh 把 `?` 当成通配符,报 `no matches found`,curl 根本没执行。
- `echo '<h1>nf</h1>' > ../../noredir/404.html` 在站点根目录放一个 404 页面。wrangler 会监视目录,文件一出现就生效。

</div>

```text
no _redirects: 200
with 404.html: 404
```

答案在 [Cloudflare Pages 的文档](https://developers.cloudflare.com/pages/configuration/serving-pages/) 里:项目根目录**没有** `404.html` 时,Pages 默认你在部署一个单页应用,任何找不到的路径都返回根页面。所以前面那条规则虽然被忽略了,深层链接还是好的,是靠这个默认行为兜着。一旦哪天有人加了个 `404.html`,深层链接就全挂了,而且没有任何报错。

我又试了另一种写法 `/*    /   200`(重写到根路径而不是 `/index.html`),在有 `404.html` 的目录里测:

```text
rule [/*    /index.html   200] -> 404 ; Parsed 0 valid redirect rules Infinite loop detected
rule [/*    /   200] -> 200 ;
```

第二种规则被正常解析(日志里是 `Parsed 1 valid redirect rule`),有没有 `404.html` 都能打开深层链接。所以 Loupe 的 `web/public/_redirects` 最终写成:

```text
/*    /   200
```

这个结论我只在本机 wrangler 4.151.3 上验证过,线上 Pages 的行为以你部署后的实测为准,smoke.py 里有一项专门测它。

这条规则还有个副作用要知道:任何不存在的路径都返回 `index.html`,包括写错的 JS 文件路径。我测了 `/assets/nope.js`,拿到的是 200 和一个 HTML。浏览器加载它会报「模块脚本的 MIME 类型不对」这类错误,而不是 404。以后线上看到这种报错,先查文件路径。

### 在 Cloudflare 控制台上真部署(这段没实跑)

我没有用自己的账号真部署,下面是按 [Pages 文档](https://developers.cloudflare.com/pages/configuration/build-image/) 2026 年 10 月的内容整理的步骤。把仓库推到 GitHub,在 Cloudflare 控制台 Workers & Pages → Create → Pages → Connect to Git,选仓库,然后填:

| 设置 | 值 | 说明 |
| --- | --- | --- |
| Root directory | `web` | monorepo 里前端在子目录 |
| Build command | `pnpm build` | 跑 `package.json` 的 build 脚本,类型检查不过就部署失败 |
| Build output directory | `dist` | Vite 的默认输出目录 |
| `VITE_API_BASE` | `https://你的后端地址` | 构建时写进 JS |
| `VITE_DEMO` | `1` | 打开 Day 674 的演示横幅 |
| `PNPM_VERSION` | 你本机 `pnpm -v` 的版本 | 见下 |

两个查到的细节。构建镜像默认是 v3,默认 Node 是 22.16.0,所以不用再设 `NODE_VERSION`,除非你本机用的是别的大版本(也可以在项目根放 `.nvmrc`)。默认 pnpm 是 10.11.1,而且文档写明**不会**从 `pnpm-lock.yaml` 识别 pnpm 版本。我查到 pnpm 最新已经是 12.14.0,你本机要是用 12 生成的锁文件,线上 10 去装可能不认,所以显式设 `PNPM_VERSION` 最稳。

部署好以后在 Custom domains 里绑 `loupe.你的域名`,再回后端把 `LOUPE_CORS` 改成这个域名。

## 第四步:后端,两条路线

后端只有两条硬约束:一个进程,持久盘。先在本机把违反约束的后果演示出来,再看两条路线分别用哪一行满足它们。

### 故意制造一次:写成两个进程

把 `--workers 1` 改成 `--workers 2` 起服务,连发 12 次重跑,再看健康检查返回的进程号:

```bash
cd agent-loupe/server
set -a; . ../deploy/rehearsal.env; set +a
uv run uvicorn loupe.app:create_app --factory --port 8000 --workers 2
# 另一个终端
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:8000/api/runs/nope/replay; done; echo
for i in 1 2 3 4 5 6; do curl -s localhost:8000/api/health | python3 -c "import json,sys;print(json.load(sys.stdin)['pid'],end=' ')"; done; echo
```

<div class="line-notes">

- `--workers 2` uvicorn 起两个子进程,共用一个端口,操作系统把每个新连接分给其中一个。
- `for i in $(seq 1 12)` shell 的循环,`seq 1 12` 产生 1 到 12,相当于 JS 的 `for (let i = 1; i <= 12; i++)`。循环体里 `-X POST localhost:8000/api/runs/nope/replay` 对一个不存在的运行发重跑。它会返回 400,但 guard 在路由之前计数,所以每一次都占额度。用不存在的运行是为了不真的调模型。
- `python3 -c "import json,sys;print(json.load(sys.stdin)['pid'],end=' ')"` 从健康检查的 JSON 里取出 `pid`,看这次请求落在哪个进程。

</div>

```text
400 400 400 400 400 400 429 429 429 400 429 400
18684 18683 18683 18683 18683 18683
```

每个 IP 每小时本该只有 5 次,这里 12 次里放过了 8 次(8 个 400)。两个进程号 18683 和 18684 说明请求被分到了两个进程,各数各的,第 10 次和第 12 次落到还没满 5 次的那个进程上,又被放了进去。进程越多,漏得越多。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="一个进程时 12 次请求共用一份计数,第 6 次起被拦;两个进程时各自计数,共放过 8 次">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="30" fill="var(--ink)">--workers 1</text>
    <rect x="120" y="16" width="300" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="132" y="33" fill="var(--compute)">一份计数 hits["127.0.0.1"]</text>
    <text x="440" y="33" fill="var(--ink-soft)">放 5 次,第 6 次起 429</text>
    <text x="20" y="100" fill="var(--ink)">--workers 2</text>
    <rect x="120" y="76" width="200" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="132" y="93" fill="var(--compute)">进程 18683 自己数</text>
    <rect x="120" y="110" width="200" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="132" y="127" fill="var(--compute)">进程 18684 自己数</text>
    <text x="340" y="110" fill="var(--ink-soft)">实测 12 次放过 8 次</text>
    <text x="20" y="176" fill="var(--ink-faint)">要多进程就把计数挪到 Redis(Day 674 练习),在那之前只开一个进程</text>
  </g>
</svg>
<figcaption>内存里的限流计数是每个进程一份。这张图对应上面那次实跑:两个进程把「每小时 5 次」变成了实际放过 8 次。</figcaption>
</figure>

### 故意制造一次:uvicorn 自己也在读 X-Forwarded-For

这是彩排里我最没想到的一个坑。一开始 `start.sh` 里没有 `--no-proxy-headers`,`TRUST_PROXY` 也是空的,按 Day 674 的逻辑应该「谁的头都不信」。我每次请求带一个不同的伪造 `X-Forwarded-For`:

```bash
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " -X POST -H "x-forwarded-for: 6.6.6.$i" localhost:8000/api/runs/nope/replay; done
```

```text
400 400 400 400 400 400 400 400  <- 没加 --no-proxy-headers
400 400 400 400 400 429 429 429  <- 加了 --no-proxy-headers
```

没加的时候 8 次全放过,限流被完全绕过。原因在 uvicorn 这一层:它默认开着 proxy headers,对来自 `--forwarded-allow-ips`(默认是 127.0.0.1)的连接,会用 `X-Forwarded-For` 的值改写 `request.client.host`。本机 curl 正好来自 127.0.0.1,于是 uvicorn 把伪造的 `6.6.6.1` 当成了客户端地址,`client_ip` 拿到的 `request.client.host` 已经是被改过的。

`uv run uvicorn --help` 里能看到这两个参数:

```text
  --proxy-headers / --no-proxy-headers
                                  Enable/Disable X-Forwarded-Proto,
                                  X-Forwarded-For to populate url scheme and
                                  remote address info.
  --forwarded-allow-ips TEXT      Comma separated list of IP Addresses, IP
                                  Networks, or literals (e.g. UNIX Socket
                                  path) to trust with proxy headers. ...
```

两层代码都在解释同一个头,结果就看谁先动手。我选择关掉 uvicorn 这一层,让 `client_ip` 一个人负责,理由是它有测试(Day 674 的 `test_client_ip_ignores_forged_headers`),规则写在我们自己的代码里,看得见。

### 路线 A:Fly.io(这段没实跑)

Fly.io 用 Dockerfile 构建镜像,支持持久卷,机器空闲时能自动停、来请求再自动启。本机没有 Docker,也没用账号部署,下面的 Dockerfile 没构建过,`fly.toml` 用脚本做了静态检查。

先说钱。2026 年 10 月我在 [Fly 定价页](https://docs.fly.io/about/pricing) 查到:新组织**没有免费额度**,只有一个最多 2 小时机器运行时间或 7 天的试用;最小的 shared-cpu-1x 256MB 机器连续跑一个月 2.19 美元(iad/ewr 区);卷按预配容量每 GB 每月 0.15 美元,机器停着也收。配上 `auto_stop_machines`,演示站大部分时间是停着的,实际花费会比 2.19 低。东京区(nrt)单价可能不同,部署前再看一眼。

```dockerfile
# agent-loupe/server/Dockerfile  在仓库根目录构建:docker build -f server/Dockerfile -t loupe .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/loupe ./loupe
COPY server/scripts ./scripts
COPY server/prices.json ./prices.json
COPY samples /app/samples
ENV PATH="/app/server/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
```

<div class="line-notes">

- `docker build -f server/Dockerfile -t loupe .` 最后那个 `.` 是构建上下文,也就是仓库根目录。因为要把根目录的 `samples/` 也拷进镜像,所以不能在 `server/` 里构建。
- `FROM python:3.12-slim` 基础镜像,Debian 精简版加 Python 3.12。
- `COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv` 从 uv 官方镜像里只拷出 uv 这一个可执行文件。0.13.5 是我查到的最新版,你用的时候换成当时的版本。[Day 422](/blog/agent-zero/day-422-dockerfile-prod/) 讲过这种写法。
- `WORKDIR /app/server` 后面的命令都在这个目录里执行,和本机在 `server/` 里启动保持一致,`start.sh` 里的相对路径就不用改。
- `RUN uv sync --frozen --no-dev --no-install-project` 先只拷依赖清单再装依赖。代码变了而依赖没变时,这一层能用缓存。`--frozen` 严格按 `uv.lock` 装,`--no-dev` 不装 pytest。
- `COPY server/prices.json ./prices.json` 价格表放在 `loupe/` 的上一级,Day 660 的 `load_prices` 默认就在那里找。
- `COPY samples /app/samples` 样例拷到 `/app/samples`,`fly.toml` 里用 `LOUPE_SAMPLES` 指过来。
- `ENV PATH="/app/server/.venv/bin:$PATH" PYTHONUNBUFFERED=1` 把虚拟环境放到 PATH 最前面,`start.sh` 里直接写 `python`、`uvicorn` 就能找到;`PYTHONUNBUFFERED=1` 让 print 立刻输出,`fly logs` 才看得到。
- `CMD ["sh", "scripts/start.sh"]` 容器启动时执行的就是本机彩排过的那个脚本。

</div>

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
  LOUPE_CORS = "https://loupe.example.com"
  LOUPE_DB = "/data/loupe.db"
  LOUPE_SAMPLES = "/app/samples"
  HOST = "0.0.0.0"
  LLM_BASE_URL = "https://api.deepseek.com"
  LLM_MODEL = "deepseek-flash"

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

<div class="line-notes">

- `app = "agent-loupe-demo"` 应用名,会变成 `agent-loupe-demo.fly.dev`。全 Fly 唯一,被占了就换。
- `primary_region = "nrt"` 东京。选离访客近的,`fly platform regions` 能列出所有区域代码。
- `dockerfile = "server/Dockerfile"` 告诉 Fly 用哪个 Dockerfile,构建上下文是 `fly.toml` 所在的根目录,和上面的 `docker build ... .` 一致。
- `TRUST_PROXY = "fly"` Fly 的代理会加 `Fly-Client-IP` 头。[Fly 文档](https://docs.fly.io/networking/request-headers) 对它的描述是「从 Fly 代理的角度看到的客户端地址」,同时提醒 `X-Forwarded-For` 要小心伪造。
- `LOUPE_CORS = "https://loupe.example.com"` 换成你 Pages 绑定的域名。只写这一个,不写 `*`。
- `LOUPE_DB = "/data/loupe.db"` 数据库放在下面挂载的卷上。写成相对路径的话,库在镜像的可写层里,机器一重启就没了。
- `HOST = "0.0.0.0"` Fly 的代理从容器外面连进来,只监听 127.0.0.1 会连不上。
- `LLM_MODEL = "deepseek-flash"` 模型名必须和 `prices.json` 里的键一致,否则 Day 660 的 `fill_costs` 算不出成本,花费上限又失效了。
- `[[mounts]]` 挂一个名叫 `loupe_data` 的卷到 `/data`,这就是「持久盘」。
- `internal_port = 8000` Fly 代理把外面的 443 转到容器里的 8000。
- `auto_stop_machines = "stop"` 没请求时停机,省钱。代价是冷启动:停了以后第一个访客要多等几秒。
- `min_machines_running = 0` 允许全停。想让第一个访客不等,就改成 1,钱按一直开着算。

</div>

`fly.toml` 里的错不会在部署时报出来,会在上线以后以「限流不生效」「重启数据没了」的样子出现。所以我写了个小脚本在部署前检查它。Python 3.11 起标准库自带 `tomllib` 读 TOML,相当于 JS 里用 `smol-toml` 这类包解析:

```python
# agent-loupe/scripts/check_deploy_config.py  部署前检查 fly.toml:key 不能写在明文里,演示必备的变量都在
import sys
import tomllib

path = sys.argv[1] if len(sys.argv) > 1 else "fly.toml"
with open(path, "rb") as f:
    cfg = tomllib.load(f)
env = cfg.get("env", {})
problems = []
for k in ["LOUPE_DEMO", "TRUST_PROXY", "DAILY_BUDGET_USD", "LOUPE_CORS", "LOUPE_DB"]:
    if k not in env:
        problems.append(f"[env] 缺 {k}")
if any("KEY" in k or "TOKEN" in k for k in env):
    problems.append("key/token 写进了 [env],应该用 fly secrets set")
if "*" in env.get("LOUPE_CORS", ""):
    problems.append("LOUPE_CORS 不能是 *")
if env.get("TRUST_PROXY") != "fly":
    problems.append(f"部署在 Fly 上 TRUST_PROXY 应该是 fly,现在是 {env.get('TRUST_PROXY')!r}")
mounts = cfg.get("mounts", [])
if not any(m.get("destination") == "/data" for m in mounts) or not env.get("LOUPE_DB", "").startswith("/data/"):
    problems.append("数据库不在持久卷 /data 上,重启就丢")
print("\n".join(problems) or "fly.toml 检查通过")
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `import tomllib` 标准库,不用 `uv add`。只能读不能写。
- `path = sys.argv[1] if len(sys.argv) > 1 else "fly.toml"` 命令行第一个参数是文件路径,不给就默认 `fly.toml`。`sys.argv` 相当于 Node 的 `process.argv.slice(1)`。
- `with open(path, "rb") as f:` `tomllib.load` 要求二进制模式打开,写成 `"r"` 会报 `TypeError`。
- `env = cfg.get("env", {})` 读出 `[env]` 那一节,是个 dict。实跑时它有 10 个键。
- `for k in ["LOUPE_DEMO"` 演示站必须有的五个变量,少一个就记一条问题。
- `if any("KEY" in k or "TOKEN" in k for k in env):` 变量名里带 KEY 或 TOKEN 的不该出现在 `[env]`,因为 `fly.toml` 是要提交进仓库的。key 用 `fly secrets set`,它加密存储、以环境变量的形式注入。
- `if env.get("TRUST_PROXY") != "fly":` 上面演示过,这个值写错限流就能被绕过。
- `mounts = cfg.get("mounts", [])` `[[mounts]]` 是 TOML 的「表数组」写法,读出来是一个 list,里面每个元素是 dict。
- `if not any(m.get("destination") == "/data"` 两个条件都要满足:确实挂了卷到 `/data`,并且数据库路径在 `/data/` 下面。只挂卷不改路径,和没挂一样。
- `print("\n".join(problems) or "fly.toml 检查通过")` 没有问题时 `join` 得到空字符串,`or` 就取后面那句。
- `sys.exit(1 if problems else 0)` 有问题退出码 1,可以放进 CI,失败就不部署。

</div>

对正确的 `fly.toml` 和一份故意改坏的(`TRUST_PROXY` 改成 `xff`,`LOUPE_DB` 改成相对路径)各跑一次:

```bash
uv run --project server python scripts/check_deploy_config.py fly.toml
uv run --project server python scripts/check_deploy_config.py ../logs/fly-bad.toml; echo "exit=$?"
```

```text
fly.toml 检查通过
部署在 Fly 上 TRUST_PROXY 应该是 fly,现在是 'xff'
数据库不在持久卷 /data 上,重启就丢
exit=1
```

检查过了再部署。先装好 `flyctl` 并 `fly auth login`,然后:

```bash
fly launch --no-deploy --copy-config        # 用现成的 fly.toml 建应用,先不部署
fly volumes create loupe_data --size 1 --region nrt
fly secrets set LLM_API_KEY=sk-你的key LOUPE_ADMIN_TOKEN=一个长随机串
fly deploy
fly scale count 1                           # 确保只有一台机器
```

<div class="line-notes">

- `fly launch --no-deploy --copy-config` 按当前目录的 `fly.toml` 在 Fly 上登记应用。参数以你装的版本 `fly launch --help` 为准,我没实跑。
- `fly volumes create loupe_data --size 1 --region nrt` 建 1 GB 的卷,名字要和 `[[mounts]]` 的 `source` 一样,区域要和 `primary_region` 一样。卷只能挂在同一区域的一台机器上,这也天然保证了单实例。
- `fly secrets set LLM_API_KEY=sk-你的key LOUPE_ADMIN_TOKEN=一个长随机串` key 只放这里。[Day 424](/blog/agent-zero/day-424-secrets-mgmt/) 讲过密钥为什么不进配置文件。
- `fly scale count 1` Fly 有时会默认起两台机器做高可用。对 Loupe 来说两台就是两份限流计数,所以显式缩成一台。

</div>

### 路线 B:自己的云服务器(这段没实跑)

一台最便宜的云服务器就够,不用 Docker。登服务器、建用户在 [Day 420](/blog/agent-zero/day-420-linux-1/) 讲过,systemd 在 [Day 421](/blog/agent-zero/day-421-linux-2/) 讲过。本机是 macOS,没有 systemd,下面的配置没跑过。

```bash
# 服务器上
curl -LsSf https://astral.sh/uv/install.sh | sh
git clone https://github.com/你的用户名/agent-loupe.git /opt/agent-loupe
cd /opt/agent-loupe/server && uv sync --frozen --no-dev
```

<div class="line-notes">

- `curl -LsSf https://astral.sh/uv/install.sh | sh` uv 官方安装脚本。
- `git clone https://github.com` 代码放 `/opt/agent-loupe`。`/opt` 是 Linux 上放第三方软件的惯例目录。
- `uv sync --frozen --no-dev` 和 Dockerfile 里一样,按锁文件装,不装开发依赖。

</div>

```ini
# /etc/systemd/system/loupe.service
[Unit]
Description=Agent Loupe API
After=network.target

[Service]
WorkingDirectory=/opt/agent-loupe/server
EnvironmentFile=/etc/loupe.env
ExecStart=/bin/sh scripts/start.sh
Environment=PATH=/opt/agent-loupe/server/.venv/bin:/usr/bin:/bin
Restart=on-failure
DynamicUser=yes
StateDirectory=loupe

[Install]
WantedBy=multi-user.target
```

<div class="line-notes">

- `After=network.target` 网络起来以后再启动。
- `WorkingDirectory=/opt/agent-loupe/server` 和本机一样在 `server/` 里启动,`start.sh` 里的相对路径不用改。
- `EnvironmentFile=/etc/loupe.env` 环境变量从这个文件读,文件权限设成 600,只有 root 能看。
- `ExecStart=/bin/sh scripts/start.sh` 执行的还是那个彩排过的脚本。
- `Environment=PATH=/opt/agent-loupe/server/.venv/bin:/usr/bin:/bin` 让脚本里的 `python`、`uvicorn` 找到虚拟环境里的版本。
- `Restart=on-failure` 进程崩了自动拉起来。
- `DynamicUser=yes` systemd 临时分配一个没有权限的用户来跑服务,就算服务被打穿也改不了系统文件。
- `StateDirectory=loupe` 自动创建 `/var/lib/loupe` 并给这个临时用户写权限,数据库就放这里,这是路线 B 的「持久盘」。

</div>

```bash
# /etc/loupe.env (chmod 600)
LOUPE_DB=/var/lib/loupe/loupe.db
LOUPE_DEMO=1
TRUST_PROXY=xff
DAILY_BUDGET_USD=0.5
LOUPE_CORS=https://loupe.你的域名
LOUPE_SAMPLES=/opt/agent-loupe/samples
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
```

<div class="line-notes">

- `LOUPE_DB=/var/lib/loupe/loupe.db` 放在 `StateDirectory` 给的目录里。
- `TRUST_PROXY=xff` 前面只有一层自己的 Caddy,它把真实客户端地址追加在 `X-Forwarded-For` 末尾,Day 674 的 `client_ip` 取最后一个。如果在 Caddy 前面又套了 Cloudflare 代理(DNS 里的橙色云朵),就是两层代理,要改成 `cloudflare`,并在防火墙上只放行 Cloudflare 的 IP 段。
- `LLM_API_KEY=sk-你的key` 这个文件不进仓库,只在服务器上。

</div>

uvicorn 只监听 127.0.0.1,外面通过 Caddy 访问。Caddy 会自动申请和续期 HTTPS 证书,[Day 425](/blog/agent-zero/day-425-deploy-route/) 用过它:

```text
# /etc/caddy/Caddyfile
api.loupe.你的域名 {
    reverse_proxy 127.0.0.1:8000
}
```

<div class="line-notes">

- `api.loupe.你的域名 {` 写域名 Caddy 就会自动去申请证书,前提是 DNS 已经指向这台服务器、80 和 443 端口开着。
- `reverse_proxy 127.0.0.1:8000` 把请求转给本机的 uvicorn,并在 `X-Forwarded-For` 末尾追加客户端地址。

</div>

两条路线怎么选?我自己会这样想:

| | Fly.io | 自己的云服务器 |
| --- | --- | --- |
| 单进程靠什么 | `fly scale count 1` + 卷只能挂一台 | `--workers 1` + 只有一台机器 |
| 持久盘靠什么 | `[[mounts]]` 卷 | `StateDirectory` |
| 真实 IP 从哪来 | `Fly-Client-IP` | Caddy 追加的 XFF 最后一个 |
| HTTPS | Fly 自动 | Caddy 自动 |
| 钱 | 没免费额度,最小机器连续跑 2.19 美元/月,可自动停 | 按服务器月租,一般更贵但能跑别的东西 |
| 要会什么 | Dockerfile、flyctl | SSH、systemd、防火墙 |

如果你已经有一台服务器在跑 SupportPilot,就用路线 B,多一个 systemd 服务而已。没有的话路线 A 省事。

## 第五步:性能表,先量能自动量的

[Day 663](/blog/agent-zero/day-663-loupe-perf/) 给了性能测量的方法:接口耗时用 curl 或脚本,首屏时间用 `performance.mark`,滚动帧率用控制台脚本。今天能自动量的是前两行,也就是步骤接口。先用 curl 量两次感受一下:

```bash
curl -s -o /dev/null -w "%{time_total}s %{size_download}B\n" "localhost:8000/api/runs/syn10000/steps?from=0&limit=5000"
curl -s -o /dev/null -w "%{time_total}s %{size_download}B\n" "localhost:8000/api/runs/syn10000/steps?from=0&limit=5000&full=true"
```

```text
0.091792s 284860B
0.261422s 5422554B
0.099216s 284860B
0.162195s 5422554B
```

同一个请求两次差了将近一倍(0.26 秒和 0.16 秒),一次的数字不能填表。所以写个脚本跑 N 次取中位数:

```python
# agent-loupe/scripts/perf_api.py  量步骤接口:每种请求跑 N 次取中位数,填性能表的前两行
# 用法:uv run --project server python scripts/perf_api.py <后端地址> [run_id] [次数]
import statistics
import sys
import time

import httpx

api = sys.argv[1].rstrip("/")
run_id = sys.argv[2] if len(sys.argv) > 2 else "syn10000"
n = int(sys.argv[3]) if len(sys.argv) > 3 else 5
cases = {"轻步骤 limit=5000": "", "完整内容 full=true": "&full=true"}

with httpx.Client(timeout=60) as c:
    for name, extra in cases.items():
        url = f"{api}/api/runs/{run_id}/steps?from=0&limit=5000{extra}"
        times, size = [], 0
        for _ in range(n):
            t0 = time.perf_counter()
            r = c.get(url)
            times.append((time.perf_counter() - t0) * 1000)
            size = len(r.content)
        print(f"{name}: 中位数 {statistics.median(times):.0f} ms,最慢 {max(times):.0f} ms,"
              f"{size / 1024:.0f} KB,{len(r.json())} 步(共 {n} 次:{[round(t) for t in times]})")
```

<div class="line-notes">

- `import statistics` 标准库,有 `median`(中位数)。中位数比平均数稳:一次偶然的慢请求会把平均拉高,中位数不受影响。
- `import httpx` [Day 64](/blog/agent-zero/day-064-httpx-1/) 学过的 HTTP 客户端,相当于 Python 里的 `fetch`。`server/` 的依赖里已经有它,所以用 `--project server` 借那个环境跑。
- `api = sys.argv[1].rstrip("/")` 去掉末尾的斜杠,免得拼出 `//api`。
- `run_id = sys.argv[2] if len(sys.argv) > 2 else "syn10000"` 默认量 Day 663 造的一万步合成样例。
- `cases = {"轻步骤 limit=5000": ""` 两种请求:前端实际用的一页 5000 条轻步骤,和带完整输入输出的 `full=true`。dict 的值是要拼到网址后面的参数。
- `with httpx.Client(timeout=60) as c:` 复用同一个连接,量的是接口本身,不是每次重新握手。线上量的时候 HTTPS 握手会让第一次明显更慢,这也是为什么要多跑几次。
- `t0 = time.perf_counter()` 高精度计时器,相当于浏览器的 `performance.now()`,单位是秒。
- `times.append((time.perf_counter() - t0) * 1000)` 换算成毫秒存起来。
- `size = len(r.content)` 响应体的字节数。
- `statistics.median(times):.0f` 中位数,保留 0 位小数。实跑轻步骤那组 5 次是 `[131, 142, 89, 75, 74]`,排序后中间那个是 89。
- `len(r.json())` 返回了多少步,确认确实拿到了 5000 条,不是一个报错的 JSON。

</div>

```bash
cd agent-loupe
uv run --project server python scripts/perf_api.py http://localhost:8000 syn10000 5
```

```text
轻步骤 limit=5000: 中位数 89 ms,最慢 142 ms,278 KB,5000 步(共 5 次:[131, 142, 89, 75, 74])
完整内容 full=true: 中位数 200 ms,最慢 208 ms,5295 KB,5000 步(共 5 次:[200, 200, 208, 166, 161])
```

两个数字放在一起看才有意义:同样 5000 步,带完整内容的响应是 5295 KB,轻步骤是 278 KB,大了 19 倍,耗时多一倍多。这就是 Day 660 做「轻步骤 + 点开再拉详情」的理由,现在有数字了。还要注意这是本机直连,没有网络传输;线上 5 MB 的响应在普通网络上光下载就要几秒,差距只会更大。

本机测出来的数填进表。前端的四行要在浏览器里量,我这次没有跑(彩排用的是精简前端,没有 Day 662 的时间轴组件),方法见 Day 663,测完回填:

| 指标 | 本机(2019 款 Intel MBP) | CPU 4× 降速 | 线上演示站 |
| --- | --- | --- | --- |
| 步骤接口 limit=5000 中位数 | 89 ms(278 KB) | 不适用 | |
| 步骤接口 full=true 中位数 | 200 ms(5295 KB) | 不适用 | |
| 首屏时间(中位数,ms) | | | |
| 滚动 avgFps | | | |
| 滚动 p95 帧间隔(ms) | | | |
| 滚动 longFrames | | | |

「线上演示站」那一列部署后用同一个脚本量,把地址换成 `https://api.loupe.你的域名`。CPU 降速是 DevTools 里模拟慢电脑的,只影响浏览器,对后端接口没有意义,所以写「不适用」。

## 第六步:上线清单,能自动的写成脚本

[Day 432](/blog/agent-zero/day-432-prod-project-1/) 说过,清单的每一项都要实际操作,不要「应该没问题」。但人在部署完的兴奋里最容易跳项,所以我把能自动化的八项写成一个脚本,部署完先跑它,再手动过剩下的:

```python
# agent-loupe/scripts/smoke.py  上线检查清单里能自动化的部分
# 用法:uv run --project server python scripts/smoke.py <后端地址> <前端地址>
# 注意:第 5 项会用掉你这个 IP 当前一小时的重跑额度
import re
import sys

import httpx

api, web = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
results: list[tuple[bool, str]] = []


def check(ok: bool, what: str) -> None:
    results.append((ok, what))
    print("通过" if ok else "失败", what)


with httpx.Client(timeout=20) as c:
    h = c.get(f"{api}/api/health").json()
    check(h["runs"] > 0, f"后端活着,库里有 {h['runs']} 条运行")

    r = c.post(f"{api}/api/import", headers={"origin": web})
    check(r.status_code == 403, f"导入被关掉了(状态码 {r.status_code})")
    check(r.headers.get("access-control-allow-origin") == web, "被拒绝的响应也带 CORS 头")

    r = c.get(f"{api}/api/runs", headers={"origin": "https://evil.example"})
    check("access-control-allow-origin" not in r.headers, "别的域名拿不到 CORS 许可")

    codes = [c.post(f"{api}/api/runs/nope/replay").status_code for _ in range(6)]
    check(codes[-1] == 429, f"连续 6 次重跑,最后一次被限流:{codes}")

    r = c.post(f"{api}/api/runs/nope/replay", headers={"x-forwarded-for": "9.9.9.9"})
    check(r.status_code == 429, f"伪造 X-Forwarded-For 绕不过限流(状态码 {r.status_code})")

    r = c.get(f"{web}/diff?a=x&b=y")
    check(r.status_code == 200 and 'id="root"' in r.text, f"深层链接直接打开不是 404(状态码 {r.status_code})")

    js = re.findall(r'src="(/assets/[^"]+\.js)"', c.get(web).text)
    leaked = [p for p in js if re.search(r"sk-[A-Za-z0-9]{16,}", c.get(web + p).text)]
    check(bool(js) and not leaked, f"前端 {len(js)} 个脚本里没有 key")

failed = sum(not ok for ok, _ in results)
print(f"{len(results) - failed}/{len(results)} 项通过")
sys.exit(1 if failed else 0)
```

<div class="line-notes">

- `api, web = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")` 同时取两个参数,Python 的多重赋值相当于 JS 的 `const [api, web] = [...]`。实跑时是 `http://localhost:8000` 和 `http://localhost:4183`。
- `results: list[tuple[bool, str]] = []` 每项检查存一个「是否通过 + 说明」的二元组。
- `def check(ok: bool, what: str) -> None:` 记录并立刻打印,这样中途网络报错退出时,前面的结果已经在屏幕上了。
- `h = c.get(f"{api}/api/health").json()` 第一项:后端活着,而且样例导入了。实跑 `h["runs"]` 是 2(天气样例 + 一万步压测样例)。线上应该只有脱敏样例那几条。
- `r = c.post(f"{api}/api/import", headers={"origin": web})` 带上前端的 Origin 去导入,模拟浏览器里的跨域请求。
- `check(r.status_code == 403` 演示模式下导入必须是 403。
- `r.headers.get("access-control-allow-origin") == web` Day 674 那个坑:guard 直接返回的拒绝响应要自己补 CORS 头,否则前端只看到「跨域失败」。
- `headers={"origin": "https://evil.example"}` 用一个陌生域名请求,响应里不该有许可头。
- `codes = [c.post(f"{api}/api/runs/nope/replay").status_code for _ in range(6)]` 列表推导式连发 6 次。实跑结果 `[400, 400, 400, 400, 400, 429]`:前 5 次通过 guard 到了路由(运行不存在所以 400),第 6 次被限流。
- `headers={"x-forwarded-for": "9.9.9.9"}` 已经被限流以后,伪造一个新 IP 再试。配置正确的话照样 429;`TRUST_PROXY` 写错或 uvicorn 自己信了这个头,这里就会是 400。
- `r = c.get(f"{web}/diff?a=x&b=y")` 深层链接,检查返回的是 `index.html`(里面有 `id="root"`),不是 Pages 的 404 页面。
- `js = re.findall(r'src="(/assets/[^"]+\.js)"', c.get(web).text)` 从首页 HTML 里找出所有打包后的 JS 路径。实跑找到 1 个 `/assets/index-CgtOdTH2.js`。
- `leaked = [p for p in js if re.search(r"sk-[A-Za-z0-9]{16,}"` 逐个下载并搜长得像 key 的字符串。
- `check(bool(js) and not leaked` 一个 JS 都没找到也算失败,说明首页结构变了,这项检查失效了。
- `sys.exit(1 if failed else 0)` 有任何一项失败退出码就是 1。

</div>

本机彩排时前后端都开着,跑一次:

```bash
cd agent-loupe
uv run --project server python scripts/smoke.py http://localhost:8000 http://localhost:4183
```

```text
通过 后端活着,库里有 2 条运行
通过 导入被关掉了(状态码 403)
通过 被拒绝的响应也带 CORS 头
通过 别的域名拿不到 CORS 许可
通过 连续 6 次重跑,最后一次被限流:[400, 400, 400, 400, 400, 429]
通过 伪造 X-Forwarded-For 绕不过限流(状态码 429)
通过 深层链接直接打开不是 404(状态码 200)
通过 前端 1 个脚本里没有 key
8/8 项通过
```

重启一次后端再看启动日志,第一行是「库里已经有数据,跳过」,说明样例没有被重复导入。线上把两个地址换成真的再跑一遍。

剩下这些脚本做不了,要手动:

- [ ] 用无痕窗口打开演示站,首页能看到样例运行,点开时间轴不报错。
- [ ] 从某一步重跑一次,能跳到对比页(这一步真的会调模型,花几分钱)。
- [ ] 在页面上连续重跑到被限流,看到的是「请求太频繁」,不是「跨域失败」。
- [ ] 把 `DAILY_BUDGET_USD` 临时调到 0.0001,重跑一次后再试,看到「今天的演示额度用完了」,改回来。
- [ ] 重启后端(Fly 上 `fly apps restart 应用名`,服务器上 `systemctl restart loupe`),数据还在。
- [ ] 在 DeepSeek 控制台给这个 key 设一个月度消费上限,或者只给这个 key 充一点钱。代码里所有保护都失效时,这一道还在。
- [ ] 性能表线上那一列填完。

最后一条和倒数第二条是我最看重的。代码里的每日上限依赖价格表填对、依赖计数没 bug、依赖 `TRUST_PROXY` 没写错,今天光彩排就碰到了两种会让它失效的写法。服务商那边的硬上限不依赖你的任何代码。

## 今天的文件

| 零件(今天哪一步) | 文件 | 新建还是修改 |
| --- | --- | --- |
| 第一步:彩排变量 | `deploy/rehearsal.env` | 新建 |
| 第一步:启动入口 | `server/scripts/start.sh` | 新建 |
| 第一步:价格表 | `server/prices.json` | 修改(按今天查到的价格) |
| 第三步:SPA 回退 | `web/public/_redirects` | 新建,`/* / 200` |
| 第四步:Fly 路线 | `server/Dockerfile`、`fly.toml` | 新建 |
| 第四步:配置检查 | `scripts/check_deploy_config.py` | 新建 |
| 第四步:服务器路线 | `loupe.service`、`loupe.env`、`Caddyfile` | 在服务器上,不进仓库 |
| 第五步:接口耗时 | `scripts/perf_api.py` | 新建 |
| 第六步:上线清单 | `scripts/smoke.py` | 新建 |

本机彩排的启动顺序:终端一 `cd server && set -a; . ../deploy/rehearsal.env; set +a && uv run sh scripts/start.sh`;终端二 `cd web && VITE_API_BASE=http://localhost:8000 npx vite build && npx wrangler pages dev dist --port 4183`;终端三跑 `perf_api.py` 和 `smoke.py`。今天全程没有调模型,花费 0 元。

## 动手练习

**练习 1:演示站的每日清理。** 访客的重跑会一直往库里加运行。写 `server/scripts/cleanup_replays.py`:删掉开始时间超过 24 小时、带 `replay` 标签的运行(连同它的步骤和标签),样例不动。造三条数据(一条样例、一条 30 小时前的重跑、一条 2 小时前的重跑)验证,再跑第二次确认幂等。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scripts/cleanup_replays.py  每天跑一次:删掉超过 24 小时的访客重跑,样例不动
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

conn = sqlite3.connect(os.environ.get("LOUPE_DB", "loupe.db"))
hours = int(sys.argv[1]) if len(sys.argv) > 1 else 24
cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S")
ids = [r[0] for r in conn.execute(
    "SELECT id FROM runs WHERE started_at < ? AND id IN (SELECT run_id FROM run_tags WHERE tag = 'replay')",
    (cutoff,))]
with conn:
    for rid in ids:
        conn.execute("DELETE FROM steps WHERE run_id = ?", (rid,))
        conn.execute("DELETE FROM run_tags WHERE run_id = ?", (rid,))
        conn.execute("DELETE FROM runs WHERE id = ?", (rid,))
left = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
print(f"截止 {cutoff} UTC,删掉 {len(ids)} 条重跑:{ids};库里还剩 {left} 条运行")
```

<div class="line-notes">

- `hours = int(sys.argv[1]) if len(sys.argv) > 1 else 24` 保留时长可以从命令行传,测试时方便。
- `cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours))` 现在的 UTC 时间减 24 小时。用 UTC 是因为 `runs.started_at` 存的就是 UTC,和 Day 674 的 `spent_today` 一致。实跑时 cutoff 是 `2026-10-21T04:54:33`。`.strftime(...)` 把它转成和库里一样格式的字符串,这种格式的字符串按字典序比较就等于按时间比较,所以 SQL 里能直接用 `<`。
- `WHERE started_at < ? AND id IN (SELECT run_id FROM run_tags WHERE tag = 'replay')` 两个条件同时满足才删:够老,并且是重跑。样例的标签是 `sample` 或 `synthetic`,不会被选中。
- `with conn:` 三条 DELETE 在一个事务里,要么全删要么全不删,不会留下没有运行的孤儿步骤。
- `conn.execute("DELETE FROM steps WHERE run_id = ?", (rid,))` 先删步骤和标签,再删运行。`(rid,)` 是只有一个元素的元组,逗号不能省。

</div>

造数据的脚本(放在练习目录,不进仓库):

```python
# 练习用:造三条运行
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")
from loupe import db

conn = db.connect(sys.argv[1])
now = datetime.now(timezone.utc)


def add(rid: str, hours_ago: int, tags: list[str]) -> None:
    t = (now - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%S")
    db.save_trace(conn, [{"type": "run_start", "id": rid, "name": rid, "started_at": t, "tags": tags},
                         {"type": "step", "idx": 0, "kind": "llm", "name": "chat"}])


add("sample-weather", 500, ["sample"])
add("replay-old", 30, ["replay"])
add("replay-new", 2, ["replay"])
print("造了 3 条")
```

<div class="line-notes">

- `sys.path.insert(0, ".")` 在 `server/` 里运行时让 `from loupe import db` 能找到包。
- `def add(rid: str, hours_ago: int, tags: list[str]) -> None:` 用 Day 674 的 `save_trace` 写入,格式和 loupe_sdk 的 JSONL 一样:一行 run_start,一行 step。
- `add("sample-weather", 500, ["sample"])` 500 小时前的样例,够老,但不是重跑,不该被删。

</div>

```bash
cd agent-loupe/server
uv run python ../../logs/mk.py ../../logs/clean.db
LOUPE_DB=../../logs/clean.db uv run python -m scripts.cleanup_replays
LOUPE_DB=../../logs/clean.db uv run python -m scripts.cleanup_replays
```

```text
造了 3 条
截止 2026-10-21T04:54:33 UTC,删掉 1 条重跑:['replay-old'];库里还剩 2 条运行
截止 2026-10-21T04:54:33 UTC,删掉 0 条重跑:[];库里还剩 2 条运行
```

只删了 30 小时前那条重跑,样例和 2 小时前的重跑都留着;第二次跑删 0 条,说明可以放心地每天重复执行。线上在 Fly 用定时机器、在服务器用 systemd timer 或 cron 每天跑一次。

</details>

**练习 2:观察会发生什么。** 把彩排的后端用 `TRUST_PROXY=xff` 启动(本机前面并没有代理),其他不变,再跑一次 `smoke.py`。哪一项会失败?为什么只有这一项?

<details><summary>参考答案</summary>

```bash
cd agent-loupe/server
set -a; . ../deploy/rehearsal.env; set +a
TRUST_PROXY=xff uv run sh scripts/start.sh
# 另一个终端
cd agent-loupe && uv run --project server python scripts/smoke.py http://localhost:8000 http://localhost:4183
```

<div class="line-notes">

- `TRUST_PROXY=xff uv run sh scripts/start.sh` 写在命令前面的变量会覆盖 `rehearsal.env` 里那个空值,只对这次启动生效。

</div>

```text
通过 后端活着,库里有 2 条运行
通过 导入被关掉了(状态码 403)
通过 被拒绝的响应也带 CORS 头
通过 别的域名拿不到 CORS 许可
通过 连续 6 次重跑,最后一次被限流:[400, 400, 400, 400, 400, 429]
失败 伪造 X-Forwarded-For 绕不过限流(状态码 400)
通过 深层链接直接打开不是 404(状态码 200)
通过 前端 1 个脚本里没有 key
7/8 项通过
```

只有第 6 项失败。前 6 次重跑没带 `X-Forwarded-For`,`client_ip` 在 xff 模式下找不到这个头,退回到 `request.client.host`,也就是 127.0.0.1,所以第 6 次照常被限流。第 7 次带了 `x-forwarded-for: 9.9.9.9`,前面没有代理往后追加,这个头里只有客户端自己写的一个值,「取最后一个」取到的就是伪造的 9.9.9.9,一个全新的 key,于是放行,返回 400。真实攻击者每次换一个值,限流就完全失效。这说明 `TRUST_PROXY` 不是「开了更安全」的开关,而是对部署环境的声明,声明和实际不符就会出事。

</details>

**练习 3:给配置检查加一条。** `check_deploy_config.py` 现在不检查 `LLM_MODEL` 和价格表是否对得上。加一条:读 `server/prices.json`,如果 `[env]` 里的 `LLM_MODEL` 不在价格表的键里,报「模型 xxx 不在 prices.json 里,成本会算成 0」。用正确的 `fly.toml` 和一份把模型改成 `deepseek-v4-pro` 的各跑一次。

<details><summary>参考答案</summary>

在 `mounts = cfg.get("mounts", [])` 那一行前面插入:

```python
import json
import pathlib

prices = json.loads((pathlib.Path(path).resolve().parent / "server" / "prices.json").read_text(encoding="utf-8"))
model = env.get("LLM_MODEL", "")
if model not in prices:
    problems.append(f"模型 {model!r} 不在 prices.json 里,成本会算成 0,每日上限不生效")
```

<div class="line-notes">

- `pathlib.Path(path).resolve().parent / "server" / "prices.json"` 价格表相对 `fly.toml` 所在目录找,而不是相对当前目录,这样从哪里运行脚本都对。`/` 是 pathlib 拼路径的写法,相当于 Node 的 `path.join`。
- `model not in prices` dict 的 `in` 判断键是否存在,相当于 JS 的 `model in prices`。
- `{model!r}` `!r` 用 repr 打印,字符串会带引号,空字符串也能看出来是 `''`。

</div>

import 按惯例应该挪到文件顶部,这里为了看清插入的是哪几行写在了一起。跑一下(坏的那份用 sed 把模型名换掉):

```bash
cd agent-loupe
uv run --project server python scripts/check_deploy_config.py fly.toml
sed 's/LLM_MODEL = "deepseek-flash"/LLM_MODEL = "deepseek-v4-pro"/' fly.toml > fly-pro.toml
uv run --project server python scripts/check_deploy_config.py fly-pro.toml; echo "exit=$?"
rm fly-pro.toml
```

<div class="line-notes">

- `sed 's/LLM_MODEL` `sed 's/旧/新/' 原文件 > 新文件` 替换后写到新文件,原文件不动。坏的那份必须和 `fly.toml` 放在同一个目录,因为价格表是相对配置文件找的。

</div>

```text
fly.toml 检查通过
模型 'deepseek-v4-pro' 不在 prices.json 里,成本会算成 0,每日上限不生效
exit=1
```

这条检查拦住的是一个真实会发生的场景:你在线上把模型换成更强的那个试试效果,忘了更新价格表,Day 660 的 `fill_costs` 遇到不认识的模型只是跳过、不报错,于是今天花了多少钱永远显示 0。

</details>

**练习 4(开放题):性能表的前两行,你会怎么向面试官解释?** 用今天实测的两行数字,写三四句话放进 README 的「性能」一节。

<details><summary>参考答案</summary>

示范写法:

> 一万步的合成 trace(`samples/synthetic_10k.jsonl`,固定随机种子)。步骤接口一页 5000 条:轻步骤 278 KB、中位数 89 ms;带完整输入输出 5295 KB、中位数 200 ms(本机直连,2019 款 Intel MacBook Pro,5 次取中位数,`scripts/perf_api.py`)。所以时间轴只拉轻步骤,点开某一步才拉它的完整内容。线上数字见下表。

对比一下改之前的写法「步骤接口很快,支持一万步」:没有测量条件、没有对比、没有它导致的设计决定,面试官会追问「多快?怎么测的?」。改之后每个数字都能复现,而且数字直接解释了一个架构选择,这比单纯「快」有说服力得多。

</details>

**验收标准:** 本机彩排时 `smoke.py` 8/8 通过;能演示 `--workers 2` 或 `TRUST_PROXY` 写错时 smoke 或限流结果怎么变;`check_deploy_config.py` 对正确配置通过、对坏配置退出码 1;性能表前两行有你自己机器上的数字和测量条件。真部署到 Fly 或服务器是加分项,做了的话线上 `smoke.py` 也要 8/8。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 静态托管 | 只把文件原样发给浏览器、不运行后端代码的服务,如 Cloudflare Pages。前端的 `dist/` 放这里 |
| 本机彩排 | 上线前在本机用和线上相同的变量、启动脚本跑一遍,只有地址和路径不同 |
| wrangler | Cloudflare 的命令行工具,`wrangler pages dev` 能在本机模拟 Pages |
| SPA 回退 | 静态托管对找不到的路径返回 `index.html`,交给前端路由处理 |
| `_redirects` | Pages 的重定向/重写规则文件,`/* / 200` 表示所有路径都返回根页面 |
| 持久卷(volume) | 重启、重新部署后数据仍然保留的磁盘,Fly 用 `[[mounts]]` 挂载 |
| proxy headers | uvicorn 用 `X-Forwarded-For` 改写客户端地址的功能,默认对来自 127.0.0.1 的连接开启 |
| `fly secrets` | Fly 上加密保存、以环境变量注入的密钥,不写进 `fly.toml` |
| `StateDirectory` | systemd 自动创建并授权的数据目录,在 `/var/lib/` 下 |
| smoke test(冒烟测试) | 部署后最先跑的一组快速检查,只确认最关键的几件事没坏 |
| 中位数 | 一组数排序后中间那个,不受个别极端值影响,测耗时用它比平均数稳 |

## 常见误区

**以为 `_redirects` 写了就生效了。** 网上最常见的 `/* /index.html 200` 在 wrangler 4.151.3 本机模拟里被判定为死循环并忽略,深层链接能打开只是因为没有 `404.html` 时 Pages 默认按 SPA 处理。改成 `/* / 200`,并让 smoke.py 每次都测深层链接。

**改了 Pages 的 `VITE_API_BASE` 不重新部署。** 这个值在构建时被写进了 JS 文件,不重新构建就还是旧地址。

**后端开多个 worker 或多台机器。** 限流计数在每个进程的内存里,实测 `--workers 2` 时每小时 5 次的限额放过了 8 次。Fly 上记得 `fly scale count 1`。

**只设了 `TRUST_PROXY` 为空,以为就谁都不信了。** uvicorn 默认对来自 127.0.0.1 的连接开着 proxy headers,会先用 `X-Forwarded-For` 改写客户端地址。本机彩排实测 8 次伪造请求全部放行。启动参数加 `--no-proxy-headers`。

**`TRUST_PROXY` 和实际部署环境对不上。** 前面没有代理却写 `xff`,smoke 第 6 项会失败,攻击者每次换一个伪造值就能绕过限流。

**数据库写相对路径。** 在 Fly 上它落在镜像的可写层,重启就没了。`LOUPE_DB` 必须在挂载的卷下面。

**看一次 curl 的耗时就填表。** 同一个请求本机两次差了将近一倍(0.26 秒和 0.16 秒),多跑几次取中位数,并写明测量环境。

**依赖安装脚本被拦了还以为是 wrangler 坏了。** npm 11 默认不跑依赖的 postinstall,workerd 没下载二进制就起不来。用 `npm install-scripts approve workerd` 再 `npm rebuild workerd`。

## 学习资料

### 文档与文章

- [Cloudflare Pages · Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/):没有 `404.html` 时按 SPA 处理的那段原文就在这里,10 分钟。
- [Cloudflare Pages · Redirects](https://developers.cloudflare.com/pages/configuration/redirects/):`_redirects` 的语法和条数限制(2000 条静态 + 100 条动态),10 分钟。
- [Cloudflare Pages · Build image](https://developers.cloudflare.com/pages/configuration/build-image/):v3 镜像默认的 Node 和 pnpm 版本,以及 `NODE_VERSION`、`PNPM_VERSION` 怎么设,10 分钟。
- [Vite · Env Variables and Modes](https://vite.dev/guide/env-and-mode):`VITE_` 变量在构建时被替换、会进客户端代码的说明,10 分钟。
- [Fly.io · Python 文档](https://docs.fly.io/python/) 和 [Request headers](https://docs.fly.io/networking/request-headers):部署 Python 应用的官方流程,以及 `Fly-Client-IP` 的含义,30 分钟。
- [Fly.io · Pricing](https://docs.fly.io/about/pricing):部署前一定看一眼,新组织已经没有免费额度,5 分钟。
- [uvicorn · Settings](https://uvicorn.dev/settings/):`--proxy-headers` 和 `--forwarded-allow-ips` 两个参数,今天那个坑的出处,10 分钟。
- [uv · Using uv in Docker](https://docs.astral.sh/uv/guides/integration/docker/):Dockerfile 里装 uv、分层缓存依赖的官方写法,20 分钟。
- [Caddy · Reverse proxy quick-start](https://caddyserver.com/docs/quick-starts/reverse-proxy):路线 B 用到的反代写法,10 分钟。
- [OWASP · LLM10:2025 Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/):今天所有保护最终是在防这个风险,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vMLp6cENP&autoplay=0&high_quality=1" title="个人项目怎么免费上线?Cloudflare Pages 全流程实战教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>飞行认知 · 个人项目怎么免费上线?Cloudflare Pages 全流程实战教程 · 22 分钟,从连 GitHub 到绑定域名的完整操作,对着它把前端部署上去。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z5w6ekE1L&autoplay=0&high_quality=1" title="全自动HTTPS加密,开箱即用,Caddy基础入门,反向代理,负载均衡,网站托管全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 全自动HTTPS加密,开箱即用,Caddy基础入门,反向代理,负载均衡,网站托管全流程 · 11 分钟,走路线 B 的看反向代理那一段。</figcaption>
</figure>

- 麦兜搞IT《Linux Systemd完全入门|一个视频搞懂systemd的使用》(BV1Tz4y1s7QW,24 分钟):路线 B 的 service 文件看不懂哪一行,回来对照。
- 玩代码的预测师《25. 通过Docker部署FastAPI应用程序》(BV1SmG3zAEkF,12 分钟):FastAPI 打成镜像的过程,和今天的 Dockerfile 对照看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jzGzw98Eikk" title="How to Deploy Machine Learning Models with FastAPI, Docker, and Fly.io | End-to-End Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataTalksClub · How to Deploy Machine Learning Models with FastAPI, Docker, and Fly.io | End-to-End Tutorial · 直播回放较长,直接拖到部署到 Fly.io 的那一段看 flyctl 的实际操作。</figcaption>
</figure>

### 书籍

- Michael T. Nygard《Release It! Design and Deploy Production-Ready Software》第 2 版(Pragmatic Bookshelf, 2018):第 5 章「Stability Patterns」讲快速失败、限流这些模式。今天「价格表为空就拒绝启动」「部署前先跑配置检查」都是快速失败的思路。

### 开源项目与代码

- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):FastAPI 官方全栈模板,看它的 Dockerfile、反代和环境变量怎么组织。
- [laurentS/slowapi](https://github.com/laurentS/slowapi):FastAPI 的限流库,支持 Redis 后端,等你要多进程时可以参考它怎么共享计数。
- [caddyserver/caddy](https://github.com/caddyserver/caddy):路线 B 的反代,自动 HTTPS 的实现在这里。

## 自测

1. 前端改了后端地址,在 Cloudflare Pages 控制台把 `VITE_API_BASE` 改了,页面还是请求旧地址,为什么?

<details><summary>答案</summary>

`import.meta.env.VITE_API_BASE` 在构建时被直接替换成字符串写进了 JS 文件,今天在 `dist/assets/index-CgtOdTH2.js` 里能 grep 到 `http://localhost:8000`。改了环境变量要重新触发一次构建部署,新的 JS 里才是新地址。

</details>

2. 本机彩排时 `TRUST_PROXY` 是空的,为什么伪造的 `X-Forwarded-For` 仍然绕过了限流?怎么修?

<details><summary>答案</summary>

uvicorn 默认开着 proxy headers,对来自 `--forwarded-allow-ips`(默认 127.0.0.1)的连接,会用 `X-Forwarded-For` 改写 `request.client.host`。本机 curl 来自 127.0.0.1,所以 `client_ip` 退回 `request.client.host` 时拿到的已经是伪造值。启动参数加 `--no-proxy-headers`,让客户端 IP 只由我们自己有测试的 `client_ip` 决定。

</details>

3. 为什么演示站后端只能有一个进程?在 Fly 和自己服务器上分别靠哪一行保证?

<details><summary>答案</summary>

限流计数在进程内存里,多个进程各数各的,实测 `--workers 2` 时每小时 5 次放过了 8 次;SQLite 也不适合多进程并发写。自己服务器靠 `start.sh` 里的 `--workers 1` 并且只有一台机器;Fly 上同样是 `--workers 1`,再加 `fly scale count 1`,卷只能挂在一台机器上也从侧面保证了这一点。

</details>

4. `_redirects` 里写 `/* /index.html 200` 会发生什么?没有 `_redirects` 时深层链接为什么也能打开?

<details><summary>答案</summary>

在 wrangler 4.151.3 的本机模拟里,这条规则被判定为死循环并忽略(Pages 会把 `/index.html` 重定向到 `/`,又命中 `/*`)。深层链接仍然能开,是因为项目根目录没有 `404.html` 时 Pages 默认按单页应用处理,找不到的路径返回根页面。加了 `404.html` 以后这个默认行为就没了,实测返回 404。改成 `/* / 200` 两种情况都是 200。

</details>

5. 为什么性能表里的接口耗时要跑多次取中位数,而且要写明「本机直连」?

<details><summary>答案</summary>

单次耗时波动很大,本机同一请求两次就差了将近一倍(0.26 秒和 0.16 秒),第一次还可能受冷缓存影响。中位数不受个别极端值影响。写明本机直连是因为它不含网络传输时间,5295 KB 的完整内容在线上普通网络里光下载就要几秒,线上那一列要另外量。

</details>

6. 面试题:你的演示站上线第三天,DeepSeek 账单突然比平时高很多,但你代码里的每日上限显示「今天只花了 0 美元」。你怎么排查?

<details><summary>答案</summary>

先止血:在服务商控制台禁用或轮换 key,把演示站切到只读。上限显示 0 说明成本没算出来,按今天碰到的几种情况逐个查:价格表是不是空的或者 `LLM_MODEL` 改了却没更新 `prices.json`(`fill_costs` 遇到不认识的模型只跳过不报错);重跑的运行有没有带 `replay` 标签(`spent_today` 只统计带标签的);是不是开了多个进程或多台机器;key 是不是泄露了被别人直接用(服务商的用量明细和你自己的访问日志、运行记录对不上就是这种)。事后:部署前用 `check_deploy_config.py` 检查模型和价格表一致;服务商侧设硬性月度上限和告警;把这次的触发路径写进 smoke 或配置检查,让它下次在部署时就失败。

</details>

## 明天预告

Agent Loupe 已经能在线上跑了。明天 Day 676 是作品一的最后一天:**开源发布与作品包装**。写一份三十秒能看懂的 README(一句话、动图、演示链接、今天测的性能数字和测量方法),用 ADR 记下这几周最重要的几个取舍,配上一键启动脚本、CI 和发布前自查脚本,选 License 打第一个版本。今天的 `smoke.py` 和性能表,明天都会直接进 README。
