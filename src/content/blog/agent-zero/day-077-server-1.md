---
title: 'Day 77 · 后端是什么(一):进程、端口和 localhost'
description: '从你天天敲的 npm run dev 讲起:那个占着终端不退出的东西是一个进程,它在一个端口上等请求,localhost 指的就是你自己这台电脑。今天用 ps、kill、lsof 把进程和端口看清楚,用 python -m http.server 起第一个后端,再弄明白 127.0.0.1 和 0.0.0.0 的区别。'
pubDate: 2026-10-22
regime: none
tags: ['backend', 'terminal', 'python', 'agent-zero']
series: 'agent-zero'
day: 77
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 76](/blog/agent-zero/day-076-week11-review/) 把第 11 周串了一遍:天气工具 `part01/weather_cli.py` 从能用(Day 70)、能测(Day 71–74)到能查(Day 75),最后用同样的结构做了空气质量小工具,连测试带日志一起交付。

这些工具有一个共同点:敲一次命令,跑完就退出。可你做前端时天天碰到的是另一种程序:`npm run dev` 敲下去,终端就被占住了,不按 Ctrl+C 它永远不走,浏览器打开 `localhost:5173` 就能看到页面。后面课程里的 Agent 服务、MCP server、FastAPI 接口,全是这种「一直开着、等别人来找它」的程序。这周就从它讲起,今天先把最底下的三样东西弄清楚:进程、端口、localhost。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚什么是进程和 PID,会用 `ps` 找到一个进程,用 Ctrl+C 和 `kill` 停掉它。
2. 说清楚端口是干什么的,用 `python -m http.server` 起一个服务,用 `lsof` 查出「8000 端口被谁占着」,遇到 `Address already in use` 知道怎么处理。
3. 说清楚 `localhost`、`127.0.0.1`、`0.0.0.0` 分别是什么,知道为什么开发时服务应该只绑在 `127.0.0.1` 上。

今天只有两个新概念:**进程**和**端口**。localhost 是端口的「门牌地址」,放在端口里一起讲。

预计用时:2 小时。花费 ¥0,不调模型,不联外网。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/) 到 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的终端基本操作和管道、[Day 33](/blog/agent-zero/day-033-packages/) 的 `-m` 运行、[Day 59](/blog/agent-zero/day-059-http-1/) 和 [Day 60](/blog/agent-zero/day-060-http-2/) 的 HTTP 请求和状态码(`curl -v` 在那里学过)、[Day 75](/blog/agent-zero/day-075-logging/) 的 stdout 和 stderr。仓库还是那个 `agent-zero-lab`,今天的新文件都放在 `part01/` 下。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把第 1 步到第 4 步用到的命令(`ps`、`kill`、`lsof`、`http.server` 的两个参数)默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从 npm run dev 说起

先回忆一个你很熟的画面。在一个 Vite 项目里敲 `npm run dev`,终端打印出几行字,其中一行是 `Local: http://localhost:5173/`,然后光标就停在那里不动了。你打开浏览器,输入这个地址,页面出来了。改完代码不想要它了,回到终端按 Ctrl+C,它才退出。

这几步里藏着今天的全部内容:

- `npm run dev` 启动了一个程序,它没有跑完就退出,而是一直活着。操作系统把一个正在运行的程序叫作**进程**。
- 它活着是在等:等浏览器来请求页面。浏览器要能找到它,它就得在一个固定的号码上等,这个号码叫**端口**,`5173` 就是。
- `localhost` 是浏览器去找它时用的地址,意思是「就是这台电脑自己」。

前端开发服务器是别人写好的后端,你只用它。从今天开始你要自己写后端,所以要知道这三样东西在操作系统里到底长什么样。

## 第 1 步:进程,一个正在跑的程序

硬盘上的 `forever.py` 只是一个文件;你用 `python` 把它跑起来,操作系统就给它分配内存、让 CPU 执行它,这个「正在跑的实例」就是**进程**(process)。同一个文件跑两次,就是两个进程。每个进程有一个操作系统发的编号,叫 **PID**(process ID),在它活着的期间不会和别人重复。

浏览器里其实也是这样。Chrome 的任务管理器(菜单 → 更多工具 → 任务管理器)里那一列「进程 ID」就是 PID,每个标签页一个进程,一个页面卡死了能单独结束它。

写一个不会自己结束的小脚本,新建 `part01/forever.py`:

```python
# agent-zero-lab/part01/forever.py
import os
import time

pid = os.getpid()
print(f"我是进程 {pid},每 2 秒报一次到,按 Ctrl+C 停")
n = 0
while True:
    n += 1
    print(f"[{pid}] 第 {n} 次报到", flush=True)
    time.sleep(2)
```

<div class="line-notes">

- `import os` 标准库,和操作系统打交道的函数都在这里。Day 53 用过它的 `os.environ`。
- `import time` 标准库,下面要用 `time.sleep`。
- `pid = os.getpid()` 问操作系统「我自己的 PID 是多少」。我实跑时拿到的是 `41579`,你的数字会不一样,每次运行也不一样。
- `while True:` Day 19 学的 while,条件永远为真,所以永远不会自己结束。
- `print(f"[{pid}] 第 {n} 次报到", flush=True)` `flush=True` 是让这行字立刻输出。Day 75 说过 stdout 在不连终端时会攒一批再输出,加上它,下面把输出重定向到文件时也能马上看到。
- `time.sleep(2)` 睡 2 秒。睡觉的时候进程还活着,只是不占 CPU。

</div>

打开**两个终端窗口**(前端开发时你肯定这么干过:一个跑 dev server,一个敲 git)。两个窗口都先 `cd` 到仓库根目录 `/Users/你/agent-zero-lab`。

第一个窗口运行:

```bash
uv run python -m part01.forever
```

实跑输出(每 2 秒多一行):

```text
我是进程 41579,每 2 秒报一次到,按 Ctrl+C 停
[41579] 第 1 次报到
[41579] 第 2 次报到
[41579] 第 3 次报到
```

这个窗口被占住了,和 `npm run dev` 一样。切到第二个窗口,看看操作系统眼里的它:

```bash
ps -o pid,ppid,stat,etime,command -ax | grep part01.forever | grep -v grep
```

<div class="line-notes">

- `ps -o pid,ppid,stat,etime,command -ax` `ps` 是 process status,列出进程。`-ax` 表示所有进程(包括别的窗口启动的);`-o` 后面是要显示哪几列:PID、父进程 PID、状态、已经运行了多久、启动命令。<br>后面的 `| grep part01.forever`:Day 5 学的管道和 grep,所有进程有几百个,只留含 `part01.forever` 的行。<br>最后的 `| grep -v grep`:`-v` 是反过来,去掉含 `grep` 的行。不加这一截,`grep part01.forever` 这条命令自己也会出现在结果里,因为它的命令行里也有这个词。

</div>

实跑输出(第二行的长路径我缩短了):

```text
41577     1 SN         00:05 uv run python -m part01.forever
41579 41577 SN         00:05 /Users/你/agent-zero-lab/.venv/bin/python -m part01.forever
```

两行,不是一行。第一列是 PID,第二列 PPID 是「父进程」的 PID。`41577` 是 `uv run`,它准备好虚拟环境以后,自己又启动了一个 `.venv` 里的 python,就是 `41579`,和脚本打印出来的 PID 对得上。所以 `uv run` 和 `npm run` 一样,是一个帮你启动别的程序的「家长」。`etime` 是 `00:05`,已经跑了 5 秒。`stat` 里的 `S` 表示在睡觉(sleep),因为它大部分时间都在 `time.sleep(2)` 里。

还有一个更短的找法,`pgrep -fl 名字`,按命令行找进程,直接打出 PID 和命令:

```bash
pgrep -fl part01.forever
```

实跑输出:

```text
41577 uv run python -m part01.forever
41579 /Users/你/agent-zero-lab/.venv/bin/python -m part01.forever
```

### 停掉一个进程:Ctrl+C 和 kill

停进程有两种办法。

一是在它自己的窗口里按 **Ctrl+C**。我按下以后,第一个窗口的实跑输出是(traceback 里的长路径缩短了):

```text
[41727] 第 2 次报到
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part01/forever.py", line 11, in <module>
    time.sleep(2)
KeyboardInterrupt
```

(这次的 PID 是 41727,因为我又重新跑了一次。)Ctrl+C 不是「强行拔电源」,它是给进程发了一个信号,叫 **SIGINT**(interrupt,中断)。Python 收到这个信号,就在当时正在执行的那一行(这里是 `time.sleep(2)`)抛出一个 `KeyboardInterrupt` 异常。没人接住,程序就带着 traceback 退出了。这就是为什么你停 Python 服务时总会看到一段 `KeyboardInterrupt`:它不是出错,是正常的停止方式。

二是从别的窗口用 **`kill PID`**。适合那种找不到原来窗口的进程(比如窗口已经关了,或者是后台跑的)。把 `forever.py` 再跑起来,在第二个窗口里:

```bash
kill 41579
```

`kill` 成功时什么也不打印。第一个窗口里,报到停了,进程退出。再跑一次 `pgrep -fl part01.forever`,什么都没有了,连父进程 `uv run` 也一起走了:孩子退出,家长也就退出了。

`kill` 这个名字有点吓人,其实它默认发的是 **SIGTERM**(terminate,请你结束),一个礼貌的请求,程序有机会收尾。还有一个 `kill -9 PID`,发的是 SIGKILL,进程没有任何收尾机会,直接被操作系统清掉。我的习惯是先 `kill`,等两三秒还在,再 `kill -9`。一上来就 `-9` 的坏处以后会碰到:比如写了一半的文件、没提交的数据库事务,都没机会处理。

| 想做的事 | 命令 | 前端里对应的 |
| --- | --- | --- |
| 看所有进程 | `ps -ax` | Chrome 任务管理器、活动监视器 |
| 按名字找进程 | `pgrep -fl 名字` | 任务管理器里搜索 |
| 在原窗口停掉 | Ctrl+C(发 SIGINT) | 停掉 `npm run dev` |
| 从别处停掉 | `kill PID`(发 SIGTERM) | 任务管理器里「结束进程」 |
| 实在停不掉 | `kill -9 PID`(发 SIGKILL) | 活动监视器里「强制退出」 |

## 第 2 步:第一个后端,python -m http.server

现在起一个真正的后端。Python 标准库自带一个最简单的 HTTP 服务器 `http.server`,作用是把一个目录里的文件通过 HTTP 发出去,相当于前端的 `npx serve` 或者 `vite preview`。不用安装任何东西。

先准备一个小目录,放两个文件。`part01/site/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>云簿帮助中心</title>
<h1>云簿帮助中心</h1>
<p>这是 python -m http.server 发给你的一个文件。</p>
```

<div class="line-notes">

- `<title>云簿帮助中心</title>` 「云簿 CloudLedger」是这门课虚构的那家 SaaS 公司,后面的帮助中心文章、工单数据都是它的。

</div>

`part01/site/faq.txt`,只有一行:

```text
发票抬头开错了怎么办:在账单页点「申请重开」。
```

**注意:`http.server` 会把你所在目录(或者 `--directory` 指定的目录)下的所有文件都发出去。** 所以一定先 `cd` 进这个专门准备的小目录再启动,别在家目录 `~` 里启动,不然你的整个家目录都能被浏览器翻。

第一个窗口:

```bash
cd part01/site
uv run python -m http.server 8000
```

<div class="line-notes">

- `cd part01/site` 进到只放了两个文件的目录。`uv run` 会从当前目录往上找 `pyproject.toml`,所以在子目录里也能用。
- `uv run python -m http.server 8000` `-m http.server` 是运行标准库里的 `http.server` 模块,和 Day 33 的 `-m part01.xxx` 是同一个用法。`8000` 是端口号,不写默认也是 8000。

</div>

实跑输出:

```text
Serving HTTP on :: port 8000 (http://[::]:8000/) ...
```

终端被占住了,它在等请求。`::` 这个奇怪的地址第 4 步再说。

用浏览器打开 `http://localhost:8000/`,能看到「云簿帮助中心」的大标题;打开 `http://localhost:8000/faq.txt` 能看到那行字。我这里用第二个窗口的 curl 代替浏览器请求了三次:首页、faq.txt 和一个不存在的文件,每次请求以后第一个窗口都会多一行:

```text
::ffff:127.0.0.1 - - [22/Oct/2026 13:19:59] "GET / HTTP/1.1" 200 -
::ffff:127.0.0.1 - - [22/Oct/2026 13:19:59] "GET /faq.txt HTTP/1.1" 200 -
::ffff:127.0.0.1 - - [22/Oct/2026 13:19:59] code 404, message File not found
::ffff:127.0.0.1 - - [22/Oct/2026 13:19:59] "GET /nope.html HTTP/1.1" 404 -
```

这是服务器的**访问日志**:谁(`127.0.0.1`,就是本机)、什么时候、请求了什么(`GET /faq.txt`)、回了什么状态码(`200`、`404`)。你在 DevTools 的 Network 面板里看到的每一行请求,在服务端都对应这样一行记录,一个从浏览器看,一个从服务器看。用浏览器打开时你多半还会看到一行 `GET /favicon.ico ... 404`,那是浏览器自己去要网站图标,目录里没有,所以 404。

再用 Day 59 学的 `curl -v` 看看完整的一来一回:

```bash
curl -v http://localhost:8000/faq.txt
```

实跑输出(去掉了进度条那几行):

```text
* Uses proxy env variable no_proxy == 'localhost,127.0.0.1,::1'
*   Trying 127.0.0.1:8000...
* Connected to localhost (127.0.0.1) port 8000 (#0)
> GET /faq.txt HTTP/1.1
> Host: localhost:8000
> User-Agent: curl/8.1.2
> Accept: */*
>
* HTTP 1.0, assume close after body
< HTTP/1.0 200 OK
< Server: SimpleHTTP/0.6 Python/3.12.13
< Date: Thu, 22 Oct 2026 05:19:59 GMT
< Content-type: text/plain
< Content-Length: 68
< Last-Modified: Thu, 22 Oct 2026 05:19:52 GMT
<
* Closing connection 0
发票抬头开错了怎么办:在账单页点「申请重开」。
```

`>` 开头是 curl 发出去的请求,`<` 开头是服务器回来的响应,Day 59–60 都见过。今天多看三行 `*` 开头的:`Trying 127.0.0.1:8000` 是 curl 去连「127.0.0.1 这台机器的 8000 端口」,`Connected to localhost (127.0.0.1) port 8000` 是连上了。第一行 `no_proxy` 是因为我本机设了代理环境变量,但 localhost 被排除在代理之外,本机的请求不走代理,这是对的。`Server: SimpleHTTP/0.6 Python/3.12.13` 是服务器自报家门。

`Content-Length: 68` 你可能会奇怪,那一行明明只有二十几个字。HTTP 里长度按**字节**算,一个中文字在 UTF-8 里占 3 个字节(Day 16 讲编码时说过),再加上中英文标点和换行,就是 68 个字节。明天自己写服务器时这个数要自己算,到时候还会碰到它。

试完回第一个窗口按 Ctrl+C 停掉服务器,会看到 `Keyboard interrupt received, exiting.`,这是 http.server 自己接住了 `KeyboardInterrupt`,打一句话再退出,比第 1 步的 traceback 体面些。

## 第 3 步:端口,进程的门牌号

一台电脑上同时跑着几百个进程。curl 发来一个请求,操作系统怎么知道该交给哪个进程?靠**端口**(port)。

打个比方:IP 地址是一栋楼的地址,端口是楼里的房间号。快递(请求)写着「127.0.0.1 这栋楼的 8000 号房间」,操作系统看房间号,把它交给在 8000 号房间里等着的那个进程。一个进程要接收请求,得先跟操作系统说「8000 号房间归我了,有人找就交给我」,这个动作叫**监听**(listen)。

端口号是 0 到 65535 的整数。有些号码约定俗成:HTTP 网站默认 80,HTTPS 默认 443(所以你访问网站时不用写端口),Postgres 数据库默认 5432。开发时大家习惯用 1024 以上的号码:Vite 是 5173,Next.js 是 3000,Python 这边常用 8000。1024 以下的端口在 macOS 和 Linux 上普通用户通常不让随便用,我在本机试了一下让 http.server 监听 `127.0.0.1` 的 80 端口,实跑直接报 `PermissionError: [Errno 13] Permission denied`。

### lsof:谁占着这个端口

把 http.server 再跑起来,在第二个窗口里查「8000 端口归谁」:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

<div class="line-notes">

- `lsof -nP -iTCP:8000 -sTCP:LISTEN` `lsof` 是 list open files,列出进程打开的东西,网络连接也算在内。`-iTCP:8000` 只看 TCP 8000 端口(HTTP 就跑在 TCP 上);`-sTCP:LISTEN` 只看「在监听」的那个,不看来来去去的连接;`-n` 不把 IP 反查成主机名,`-P` 不把端口号翻译成名字,两个都是为了显示原始数字,也更快。

</div>

实跑输出:

```text
COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
python3.1 42237 minliu    4u  IPv6 0x563949572cd62a6f      0t0  TCP *:8000 (LISTEN)
```

关键看三列:`COMMAND` 是程序名(太长被截成了 `python3.1`,其实是 python3.12),`PID` 是 42237,最后一列 `*:8000 (LISTEN)` 表示在 8000 端口监听。`*` 的意思第 4 步讲。

`-P` 不加会怎样?我试了 `lsof -i :8000`,最后一列变成了 `TCP *:irdmi`。`irdmi` 是系统服务表里 8000 端口的一个老名字,和 Python 毫无关系,第一次看到会一头雾水。所以记住带上 `-nP`。

不带端口号,能看到这台电脑上所有在监听的端口。我本机的结果挑几行:

```bash
lsof -nP -iTCP -sTCP:LISTEN
```

```text
COMMAND     PID   USER   FD   TYPE  ...  NAME
postgres  29027 minliu   ...  IPv4  ...  TCP 127.0.0.1:5432 (LISTEN)
node       8121 minliu   ...  IPv6  ...  TCP [::1]:4173 (LISTEN)
python3.1 42511 minliu   ...  IPv4  ...  TCP 127.0.0.1:8000 (LISTEN)
```

Postgres 在 5432,一个 node 进程在 4173(那是我之前开着没关的 `vite preview`,它的默认端口),我们的 python 在 8000。每个都是一个进程占着一个端口在等。

### 一个端口只能有一个主人

同一个端口不能被两个进程同时监听。故意试一下:第一个窗口的 http.server 开着,第二个窗口也 `cd part01/site` 再起一个:

```bash
uv run python -m http.server 8000
```

实跑输出的最后几行(前面的 traceback 我删了):

```text
  File ".../python3.12/socketserver.py", line 478, in server_bind
    self.socket.bind(self.server_address)
OSError: [Errno 48] Address already in use
```

`Address already in use`,地址已被占用,`Errno 48` 是 macOS 上这个错误的编号(Linux 上是 98)。这是做后端最常见的报错之一,前端里 Vite 碰到端口被占会自动换成 5174,很多后端框架不会,直接报这个错退出。

碰到它,两条路:换个端口(`http.server 8001`),或者找出占着的那个进程停掉。后者的标准动作是:

```bash
lsof -t -i :8000
kill $(lsof -t -i :8000)
```

<div class="line-notes">

- `lsof -t -i :8000` `-t` 是 terse(简洁),只输出 PID,别的列都不要。实跑输出 `42511`。
- `kill $(lsof -t -i :8000)` `$( ... )` 是把括号里命令的输出放到这个位置,相当于 `kill 42511`。一行搞定「找到并停掉」。

</div>

最常见的「端口被占」其实是你自己:上次的服务器在另一个窗口里没关,或者窗口关了进程还在后台。所以先 `lsof` 看看是谁,别上来就 `kill`,万一是 Postgres 这种你需要的服务呢。

## 第 4 步:localhost、127.0.0.1 和 0.0.0.0

最后弄清楚「楼的地址」这一半。

**127.0.0.1** 是一个特殊的 IP 地址,永远指向「这台电脑自己」。发往它的数据根本不出网卡,在电脑内部转一圈就回来了,所以叫**回环地址**(loopback)。断了网也能用。

**localhost** 是一个名字,不是地址,它对应到 127.0.0.1。对应关系写在系统的 `/etc/hosts` 文件里:

```bash
grep localhost /etc/hosts
```

实跑输出(我这台机器的文件里重复写了几次,挑出不重复的):

```text
127.0.0.1	localhost
::1             localhost
```

两行。`::1` 是 IPv6 版本的 127.0.0.1(IPv6 是新一代的 IP 地址格式,写法里带冒号)。所以 localhost 其实对应两个地址。

**0.0.0.0** 和 **::** 不是用来访问的地址,是给服务器「绑定」用的,意思是「这台电脑的所有网络接口,我都监听」。一台笔记本至少有两个接口:内部的回环(127.0.0.1)和连着 Wi-Fi 的网卡(比如 192.168.x.x 或公司内网的 10.x.x.x)。

现在回头看第 2 步那行 `Serving HTTP on :: port 8000`,以及 lsof 里的 `*:8000`。http.server 默认绑的是 `::`,所有接口,而且在 macOS 上 IPv4 和 IPv6 都包括。这意味着什么?我查了自己 Wi-Fi 网卡的地址,用这个地址去请求:

```bash
ipconfig getifaddr en0
curl --noproxy '*' http://10.150.38.212:8000/faq.txt
```

<div class="line-notes">

- `ipconfig getifaddr en0` macOS 上查 Wi-Fi 网卡(通常叫 `en0`)的 IP。实跑输出 `10.150.38.212`,这是我在公司网络里分到的内网地址,你的会不一样。
- `curl --noproxy '*' http://10.150.38.212:8000/faq.txt` 用网卡地址访问。`--noproxy '*'` 让这次请求不走我本机的代理,直接连。

</div>

实跑输出:

```text
发票抬头开错了怎么办:在账单页点「申请重开」。
```

能访问,服务器日志里多了一行 `::ffff:10.150.38.212 - - ... "GET /faq.txt HTTP/1.1" 200 -`。用网卡地址能访问,就意味着**同一个网络里的其他人也能访问**:同一个 Wi-Fi 下的同事、咖啡店里的陌生人,只要知道你的 IP,就能读你 `site/` 目录里的文件。(日志里的 `::ffff:` 前缀是 IPv4 地址被装进 IPv6 格式时的写法,因为服务器绑的是 IPv6 的 `::`,可以忽略。)

开发时几乎从来不需要这样。加一个 `--bind 127.0.0.1`,只在回环接口上监听:

```bash
uv run python -m http.server 8000 --bind 127.0.0.1
```

实跑输出:

```text
Serving HTTP on 127.0.0.1 port 8000 (http://127.0.0.1:8000/) ...
```

再用三种地址各请求一次:

```bash
curl -sS --noproxy '*' http://10.150.38.212:8000/faq.txt
curl -sS http://127.0.0.1:8000/faq.txt
curl -sS "http://[::1]:8000/faq.txt"
```

实跑输出:

```text
curl: (7) Failed to connect to 10.150.38.212 port 8000 after 11 ms: Couldn't connect to server
发票抬头开错了怎么办:在账单页点「申请重开」。
curl: (7) Failed to connect to ::1 port 8000 after 20 ms: Couldn't connect to server
```

网卡地址连不上了,别人访问不到你;127.0.0.1 照常;`::1` 也连不上,因为我们只绑了 IPv4 的回环。那 `http://localhost:8000` 呢?实跑照样能拿到内容,`curl -v` 显示它 `Trying 127.0.0.1:8000...` 然后连上了。localhost 对应两个地址,能连上哪个就用哪个。

这里有个坑值得记一下:有的工具解析 localhost 时先试 `::1`,而你的服务只绑了 127.0.0.1(或者反过来),就会出现「用 127.0.0.1 能访问、用 localhost 不行」这种怪事。我在 lsof 的列表里看到 `vite preview` 就是只绑在 `[::1]:4173` 上的。碰到这种情况,把两边的地址写成一样的就好。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一台电脑上的进程分别监听不同端口,本机请求经回环地址到达,局域网请求只能到达绑定了 0.0.0.0 的服务">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="180" y="20" width="440" height="260" fill="none" stroke="var(--rule)" stroke-width="2" rx="8"/>
<text x="196" y="42" fill="var(--ink-soft)">你的电脑</text>
<rect x="200" y="60" width="150" height="40" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="212" y="84" fill="var(--ink)">回环 127.0.0.1</text>
<rect x="200" y="200" width="150" height="40" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="212" y="224" fill="var(--ink)">网卡 10.150.x.x</text>
<rect x="420" y="50" width="185" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="68" fill="var(--ink)">:8000 python</text>
<text x="430" y="86" fill="var(--ink-soft)" font-size="11">--bind 127.0.0.1</text>
<rect x="420" y="120" width="185" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="138" fill="var(--ink)">:5432 postgres</text>
<text x="430" y="156" fill="var(--ink-soft)" font-size="11">127.0.0.1</text>
<rect x="420" y="190" width="185" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="208" fill="var(--ink)">:8001 python</text>
<text x="430" y="226" fill="var(--ink-soft)" font-size="11">默认 ::(所有接口)</text>
<line x1="350" y1="80" x2="420" y2="72" stroke="var(--mem)" stroke-width="2"/>
<line x1="350" y1="80" x2="420" y2="142" stroke="var(--mem)" stroke-width="2"/>
<line x1="350" y1="80" x2="420" y2="212" stroke="var(--mem)" stroke-width="2"/>
<line x1="350" y1="220" x2="420" y2="212" stroke="var(--mem)" stroke-width="2"/>
<line x1="350" y1="220" x2="420" y2="80" stroke="var(--rule)" stroke-width="2" stroke-dasharray="5 4"/>
<text x="360" y="176" fill="var(--ink-faint)" font-size="11">✕</text>
<rect x="20" y="60" width="140" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="84" fill="var(--ink)">本机 curl/浏览器</text>
<line x1="160" y1="80" x2="200" y2="80" stroke="var(--mem)" stroke-width="2"/>
<rect x="20" y="200" width="140" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="224" fill="var(--ink)">同一 Wi-Fi 的人</text>
<line x1="160" y1="220" x2="200" y2="220" stroke="var(--mem)" stroke-width="2"/>
</g>
</svg>
<figcaption>请求先按 IP 找到「哪个接口」,再按端口找到「哪个进程」。绑 127.0.0.1 的服务只有本机能进(虚线那条走不通);绑 :: 或 0.0.0.0 的服务,同一网络里的人从网卡地址也能进。</figcaption>
</figure>

规则就一条:**开发时绑 127.0.0.1;只有你明确想让别的机器访问时(比如手机连同一个 Wi-Fi 调试页面、或者部署到服务器上),才绑 0.0.0.0**。前端里其实见过这个开关:Vite 默认只给你 `Local:` 地址,加了 `--host` 才多出一行 `Network:` 地址给手机用,`--host` 做的正是把绑定地址换成 0.0.0.0。后面写 FastAPI 时用的 uvicorn,默认绑的就是 127.0.0.1,算是替你选了安全的那个。

## 今天用到的命令汇总

今天没有「大代码」,只有一组命令。按「起服务 → 查 → 停」的顺序排好,方便默写:

| 步骤 | 命令 | 来自 |
| --- | --- | --- |
| 起一个静态文件服务,只给本机 | `uv run python -m http.server 8000 --bind 127.0.0.1` | 第 2、4 步 |
| 指定发哪个目录 | `--directory part01/site` | 练习 1 |
| 这个端口被谁占着 | `lsof -nP -iTCP:8000 -sTCP:LISTEN` | 第 3 步 |
| 只要 PID | `lsof -t -i :8000` | 第 3 步 |
| 按名字找进程 | `pgrep -fl 名字` | 第 1 步 |
| 停掉 | 原窗口 Ctrl+C;别处 `kill PID`;不行再 `kill -9 PID` | 第 1 步 |
| 查本机网卡地址 | `ipconfig getifaddr en0` | 第 4 步 |

## 动手练习

**练习 1:同时开两个服务。** 新建目录 `part01/site2/`,里面放一个 `hello.txt`,内容是「这里是 8001 号端口的服务」。在两个窗口里分别启动:8000 端口发 `part01/site`,8001 端口发 `part01/site2`,都只绑 127.0.0.1,而且**都在仓库根目录**启动(提示:用 `--directory`)。然后用 curl 分别请求两个文件,再请求一次 `http://127.0.0.1:8001/faq.txt`,看状态码;最后用一条 lsof 命令同时看两个端口。

<details><summary>参考答案</summary>

```bash
mkdir -p part01/site2
echo "这里是 8001 号端口的服务" > part01/site2/hello.txt
uv run python -m http.server 8000 --bind 127.0.0.1 --directory part01/site
uv run python -m http.server 8001 --bind 127.0.0.1 --directory part01/site2
curl -s http://127.0.0.1:8000/faq.txt
curl -s http://127.0.0.1:8001/hello.txt
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/faq.txt
lsof -nP -iTCP:8000-8001 -sTCP:LISTEN
```

<div class="line-notes">

- `echo "这里是 8001 号端口的服务" > part01/site2/hello.txt` Day 5 的重定向,把一行字写进文件。
- `uv run python -m http.server 8000 --bind 127.0.0.1 --directory part01/site` 在第一个窗口跑。`--directory` 指定发哪个目录,这样不用 `cd` 进去。
- `uv run python -m http.server 8001 --bind 127.0.0.1 --directory part01/site2` 在第二个窗口跑。下面几条在第三个窗口跑。
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/faq.txt` `-o /dev/null` 把响应内容扔掉,`-w "%{http_code}\n"` 只打印状态码。
- `lsof -nP -iTCP:8000-8001 -sTCP:LISTEN` 端口可以写成一个范围。

</div>

实跑输出(后三条命令的):

```text
发票抬头开错了怎么办:在账单页点「申请重开」。
这里是 8001 号端口的服务
404
COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
python3.1 57000 minliu    3u  IPv4 0x56394943ff9742cf      0t0  TCP 127.0.0.1:8000 (LISTEN)
python3.1 57001 minliu    3u  IPv4 0x56394943ff6e656f      0t0  TCP 127.0.0.1:8001 (LISTEN)
```

`faq.txt` 在 8001 那边是 404,因为 8001 的进程只管 `site2` 目录,两个服务互不相干。两个进程,两个 PID,两个端口,各管各的。8001 窗口的日志里有一行 `code 404, message File not found`。练完两个窗口各按 Ctrl+C。

</details>

**练习 2:找出并停掉占端口的进程。** 起一个 8000 端口的 http.server,然后**关掉那个终端窗口**(直接点窗口的关闭按钮,假装你忘了它)。在新窗口里检查 8000 是否还被占着;如果是,用一行命令停掉它,再确认端口已经空出来。

<details><summary>参考答案</summary>

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
kill $(lsof -t -i :8000)
lsof -t -i :8000 | wc -l
```

<div class="line-notes">

- `lsof -nP -iTCP:8000 -sTCP:LISTEN` 先看是谁,确认是那个 python 再动手。
- `kill $(lsof -t -i :8000)` 找到 PID 并发 SIGTERM。
- `lsof -t -i :8000 | wc -l` Day 5 的 `wc -l` 数行数,0 行就是没人占了。

</div>

我这里第一条看到的是 `python3.1 42511 ... TCP 127.0.0.1:8000 (LISTEN)`,`kill` 之后第三条实跑输出:

```text
       0
```

关窗口时进程有没有跟着退出,和终端软件的设置有关:macOS 自带的终端关窗口时一般会提示「这会终止正在运行的进程」;如果你是用 `&` 放到后台、或者用别的方式启动的,窗口关了它可能还活着。不管哪种,`lsof` 一查就清楚,这是比猜靠谱的办法。

</details>

**练习 3(观察题):按了 Ctrl+Z 会怎样?** 很多人想停服务器时手一滑按成了 Ctrl+Z。起一个 `--bind 127.0.0.1` 的 http.server,按 Ctrl+Z,然后在另一个窗口 `curl -m 3 http://127.0.0.1:8000/faq.txt`(`-m 3` 是最多等 3 秒),再用 `lsof` 看端口。观察现象并解释。

<details><summary>参考答案</summary>

我的实跑环境不是一个能按键盘的交互终端,所以我用 `kill -STOP PID` 发出和 Ctrl+Z 同一类的「暂停」信号来模拟(Ctrl+Z 发的是 SIGTSTP,效果都是让进程停住):

```bash
kill -STOP 42511
ps -o pid,stat,command -p 42511
curl -sS -m 3 http://127.0.0.1:8000/faq.txt
lsof -nP -iTCP:8000 -sTCP:LISTEN
kill -CONT 42511
```

<div class="line-notes">

- `kill -STOP 42511` 让进程暂停。`kill` 不只能「杀」,它其实是「发信号」,`-STOP` 就是发暂停信号。
- `ps -o pid,stat,command -p 42511` `-p` 只看这一个 PID。
- `curl -sS -m 3 http://127.0.0.1:8000/faq.txt` `-sS` 是安静模式但出错时仍然显示错误。
- `lsof -nP -iTCP:8000 -sTCP:LISTEN` 看端口还在不在。
- `kill -CONT 42511` 继续运行。在真的终端里,对应的是在那个窗口敲 `fg`(放回前台继续跑)。

</div>

实跑输出(`ps` 那行的长路径缩短了):

```text
  PID STAT COMMAND
42511 TN   /Users/你/agent-zero-lab/.venv/bin/python -m http.server 8000 --bind 127.0.0.1
curl: (28) Operation timed out after 3000 milliseconds with 0 bytes received
python3.1 42511 minliu    3u  IPv4 0x56394943ffc95ebf      0t0  TCP 127.0.0.1:8000 (LISTEN)
```

`STAT` 变成了 `T`(stopped,停住了)。curl 没有像服务关掉时那样立刻报「连不上」,而是傻等 3 秒超时;lsof 显示端口**还被占着**。这就是 Ctrl+Z 的坑:它不是结束进程,而是把进程冻住放到后台。端口照样占着,请求进得来却没人处理,你再起一个新服务器就会报 `Address already in use`,而原窗口里看起来什么都没在跑。

更有意思的是,`kill -CONT` 让它继续以后,服务器日志里多出了一行 `"GET /faq.txt HTTP/1.1" 200`:冻住期间那个请求一直排在门口,醒过来它还是处理了,只是 curl 早就不等了。

真碰到这种情况:回到原窗口敲 `fg` 把它叫回前台,再按 Ctrl+C;或者在别的窗口直接 `kill PID`。

</details>

**练习 4:谁是我的父进程。** 新建 `part01/whoami_proc.py`,打印自己的 PID 和父进程的 PID(提示:`os.getppid()`)。分别用 `uv run python -m part01.whoami_proc` 和 `.venv/bin/python -m part01.whoami_proc` 运行,同时用 `echo $$` 打印当前终端 shell 的 PID,对比三个数字。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/whoami_proc.py
import os

print("我的 PID:", os.getpid())
print("我爸爸的 PID:", os.getppid())
```

<div class="line-notes">

- `print("我的 PID:", os.getpid())` 自己的 PID。
- `print("我爸爸的 PID:", os.getppid())` `getppid` 多了一个 p,parent,父进程的 PID。

</div>

```bash
echo $$
uv run python -m part01.whoami_proc
.venv/bin/python -m part01.whoami_proc
```

<div class="line-notes">

- `echo $$` `$$` 是 shell 里的特殊变量,值是当前这个 shell 自己的 PID。
- `uv run python -m part01.whoami_proc` 经过 uv 启动。
- `.venv/bin/python -m part01.whoami_proc` 不经过 uv,直接用虚拟环境里的 python 启动。Day 11 讲过 `.venv` 里就是一个完整的 Python。

</div>

实跑输出(三条命令依次):

```text
56990
我的 PID: 57063
我爸爸的 PID: 57061
我的 PID: 57064
我爸爸的 PID: 56990
```

经过 `uv run` 时,父进程是 57061,也就是 `uv` 自己,不是 shell;直接用 `.venv/bin/python` 时,父进程就是 shell 56990。进程是一棵树:shell 生出 uv,uv 再生出 python。第 1 步 `ps` 里看到的两行就是这个关系。这也解释了为什么第 1 步 `kill` 掉 python 以后 uv 也跟着退出:uv 一直在等它的孩子,孩子没了它也就结束了。

</details>

**验收标准:** 能在不看文章的情况下,起一个只绑 127.0.0.1 的 http.server,用 curl 请求到文件,用 lsof 说出它的 PID,用 kill 停掉它,最后用 lsof 确认端口已空;能口头解释 `Address already in use` 怎么来的、怎么处理;能说出为什么默认的 `Serving HTTP on ::` 不适合在公共 Wi-Fi 下用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 进程(process) | 一个正在运行的程序实例。同一个 `.py` 文件跑两次就是两个进程 |
| PID | 操作系统给每个进程发的编号,`os.getpid()` 能拿到自己的 |
| 父进程 / PPID | 启动这个进程的那个进程。`uv run` 启动 python,uv 就是 python 的父进程 |
| `ps` / `pgrep` | 列出进程 / 按名字找进程 |
| 信号(signal) | 操作系统发给进程的通知。Ctrl+C 发 SIGINT,`kill` 默认发 SIGTERM,`kill -9` 发 SIGKILL,Ctrl+Z 发 SIGTSTP 让进程暂停 |
| `KeyboardInterrupt` | Python 收到 SIGINT 时抛出的异常,所以停服务时会看到它 |
| 服务端 / 后端 | 一直运行、等着别人来请求、处理完再回应的程序 |
| 端口(port) | 0–65535 的号码,操作系统靠它把网络请求交给对应的进程 |
| 监听(listen) | 进程向操作系统登记「这个端口归我」,之后发到这个端口的请求都交给它 |
| `lsof` | 列出进程打开的文件和网络连接,常用来查端口被谁占着 |
| `Address already in use` | 端口已经被别的进程监听,新进程抢不到,macOS 上是 Errno 48 |
| 127.0.0.1 / 回环地址 | 永远指向本机的 IP,数据不出网卡 |
| `::1` | IPv6 版本的回环地址 |
| localhost | 一个主机名,在 `/etc/hosts` 里对应 127.0.0.1 和 ::1 |
| 0.0.0.0 / `::` | 绑定时用的特殊地址,表示监听本机所有网络接口,局域网里别人也能访问 |
| 绑定(bind) | 服务器选择在哪个地址和端口上监听 |
| `http.server` | Python 标准库里的简单 HTTP 服务器,`python -m http.server` 把一个目录的文件发出去 |
| 访问日志 | 服务器为每个请求记的一行:谁、何时、请求什么、回了什么状态码 |

## 常见误区

**以为 Ctrl+Z 是停止。** Ctrl+Z 是暂停并挂到后台,进程还在,端口还占着,请求进得来却没人处理。练习 3 实测 curl 会一直等到超时。停服务用 Ctrl+C。

**在家目录里运行 `python -m http.server`。** 它会把当前目录下的所有文件发出去,加上默认绑的是所有接口,同一个 Wi-Fi 下的人能直接翻你的家目录。官方文档也写明了它不适合生产环境,只做了最基本的安全检查。只在专门准备的目录里启动,并且加 `--bind 127.0.0.1`。

**一碰到 `Address already in use` 就 `kill -9`。** 先 `lsof -nP -iTCP:端口 -sTCP:LISTEN` 看清楚是谁。多半是你自己没关的上一个服务,但也可能是数据库这种你需要的东西。确认后先用普通 `kill`,不行再 `-9`。

**`lsof -i :8000` 看不懂最后一列。** 不加 `-P` 时端口号会被翻译成系统服务表里的名字,8000 显示成 `irdmi`。养成 `-nP` 的习惯。

**以为 localhost 和 127.0.0.1 完全一样。** localhost 是名字,对应 127.0.0.1 和 ::1 两个地址。服务只绑了其中一个,而客户端先试了另一个,就会出现「127.0.0.1 能访问、localhost 不行」。第 4 步实测只绑 127.0.0.1 时 `[::1]` 连不上。

**以为 0.0.0.0 是一个能访问的地址。** 它是给服务器绑定用的「所有接口」,不是给客户端访问用的目标。客户端要访问,用 127.0.0.1 或者具体的网卡地址。

**`grep 名字` 找进程时把 grep 自己也找出来了。** `ps -ax | grep forever` 的结果里会多一行 `grep forever`,看到两个 PID 别以为程序跑了两份。加 `| grep -v grep`,或者直接用 `pgrep -fl`。

## 学习资料

### 文档与文章

- [MDN · 什么是 Web 服务器](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_web_server):中文,从前端视角讲「服务器」这个词的两层意思(硬件和软件)、静态服务器和动态服务器的区别。今天的 http.server 就是静态服务器,明天写的是动态的。
- [Python 文档 · http.server](https://docs.python.org/zh-cn/3/library/http.server.html):中文。页面底部的「命令行界面」一节列出了 `--bind`、`--directory` 等参数;页面开头那条警告「不推荐在生产环境中使用」值得读一下。
- [MDN · Port(英文)](https://developer.mozilla.org/en-US/docs/Glossary/Port):两段话讲清端口,附了常用端口号。
- [Vite 文档 · 开发服务器选项](https://vite.dev/config/server-options):看 `server.host` 和 `server.port`、`server.strictPort` 三项,对照今天第 3、4 步,你会发现你早就在用这些概念了。
- [ss64 · lsof(macOS)](https://ss64.com/mac/lsof.html):lsof 参数速查。终端里 `man lsof` 也能看,但太长。
- [维基百科 · localhost](https://zh.wikipedia.org/wiki/Localhost):localhost 和回环地址的来历。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hH4y1j73X&autoplay=0&high_quality=1" title="快速认识:什么是端口号" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿DD · 快速认识:什么是端口号 · 6 分钟。用快递和房间号的比方讲端口,对应第 3 步,适合学之前先看一遍建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18x4y1c79T&autoplay=0&high_quality=1" title="断网了,能ping通127.0.0.1吗?为什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小白debug · 断网了,能ping通127.0.0.1吗?为什么? · 7 分钟。讲回环地址的数据为什么不出网卡,以及 localhost、127.0.0.1、0.0.0.0 的区别,对应第 4 步。中间讲到网卡驱动的部分听个大概即可。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/g2fT-g9PX9o" title="Network Ports Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PowerCert Animated Videos · Network Ports Explained · 英文,动画讲端口,播放量很高的入门视频,和第 3 步讲的是一回事,顺带介绍了 80、443 这些常用端口。</figcaption>
</figure>

### 书籍

- 户根勤,《网络是怎样连接的》,周自恒译,人民邮电出版社(图灵),2017。从「在浏览器里输入网址」一路讲到服务器收到请求,第 1–2 章讲浏览器怎么委托操作系统发数据,和今天的端口、回环地址直接相关。整本书图很多,适合前端读。
- 上野宣,《图解 HTTP》,于均良译,人民邮电出版社,2014。这周和下周的 HTTP 服务端内容都能在里面找到对应,第 1 章讲 TCP/IP 和端口。

### 开源项目与代码

- [python/cpython 的 Lib/http/server.py](https://github.com/python/cpython/blob/main/Lib/http/server.py):今天用的 `http.server` 的源码。搜 `def test(` 能看到命令行启动时怎么处理 `--bind`,搜 `Serving HTTP on` 就是那行启动提示的出处。明天我们会照着这个文件里的 `BaseHTTPRequestHandler` 自己写处理函数。

## 自测

1. 同一个 `forever.py` 在两个窗口里各跑一次,有几个进程?它们的 PID 一样吗?

<details><summary>答案</summary>

两个进程(如果用 `uv run` 启动,严格说是四个:两个 uv、两个 python)。PID 不一样,操作系统给每个活着的进程发不重复的编号。

</details>

2. Ctrl+C、`kill PID`、`kill -9 PID`、Ctrl+Z 分别做了什么?哪个不会让进程结束?

<details><summary>答案</summary>

Ctrl+C 发 SIGINT,Python 会抛 `KeyboardInterrupt`;`kill` 默认发 SIGTERM,礼貌地请它结束;`kill -9` 发 SIGKILL,操作系统直接清掉,进程没有收尾机会;Ctrl+Z 发 SIGTSTP,只是暂停,进程还在、端口还占着,所以它不会让进程结束。

</details>

3. 启动服务时报 `OSError: [Errno 48] Address already in use`,你按什么顺序排查?

<details><summary>答案</summary>

先 `lsof -nP -iTCP:端口 -sTCP:LISTEN` 看是哪个进程占着;如果是自己忘了关的旧服务,回原窗口 Ctrl+C,找不到窗口就 `kill PID`,不行再 `kill -9`;如果是需要的服务(比如数据库),那就给新服务换一个端口。

</details>

4. 服务器绑 127.0.0.1 和绑 0.0.0.0,有什么区别?开发时用哪个?

<details><summary>答案</summary>

绑 127.0.0.1 只监听回环接口,只有本机能访问;绑 0.0.0.0(或 `::`)监听所有接口,同一网络里的其他机器也能通过你的网卡 IP 访问。开发时用 127.0.0.1,只有明确要给别的机器访问(手机调试、部署到服务器)时才用 0.0.0.0。

</details>

5. 面试题:你在本机起了一个 Agent 的 HTTP 服务,同事说他用浏览器访问 `http://你的IP:8000` 打不开,但你自己访问 `localhost:8000` 是好的。可能是什么原因,怎么查?

<details><summary>答案</summary>

最可能是服务只绑在 127.0.0.1 上,只接受本机请求。用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 看 NAME 列:是 `127.0.0.1:8000` 就是这个原因,要绑 `0.0.0.0`(想清楚安全问题,最好加鉴权)。如果已经是 `*:8000`,再查 macOS 防火墙是否拦了入站连接、两台机器是不是在同一个网络、公司网络是否隔离了设备之间的访问。反过来也要想一想:一个 Agent 服务能调工具、能花钱,绑到所有接口而不加鉴权,同网络的任何人都能调它。

</details>

## 明天预告

Day 78 · 后端是什么(二):一次请求在服务端走过的路。今天的 http.server 只会把文件原样发出去,所有逻辑都是别人写好的。明天自己写一个服务器:请求来了,先看路径决定交给哪个函数(路由),函数算出结果,再拼成状态码、响应头和响应体发回去。亲手把这条路走一遍,后天学 FastAPI 时你就知道它替你省掉了哪些活。
