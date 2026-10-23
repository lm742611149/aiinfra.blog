---
title: 'Day 59 · HTTP(一):URL、方法和一次请求的样子'
description: '从你每天看的 DevTools Network 面板讲起:一个 URL 拆成哪几段,一次请求在网线上其实是几行文字,GET 和 POST 到底差在哪。用 curl 发请求,用一个二十行的小服务器把它收到的原文打印出来,再用 Python 发一次,看三种客户端发的是不是同一种东西。'
pubDate: 2026-10-23
regime: none
tags: ['http', 'agent-zero']
series: 'agent-zero'
day: 59
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 58](/blog/agent-zero/day-058-git-3/) 把 `agent-zero-lab` 推到了 GitHub:`git push` 在背后通过 SSH 和一台远程机器说话,被拒绝时会告诉你 `fetch first`。你可能没留意,那是你第一次在这门课里「让一台电脑去找另一台电脑要东西或者送东西」。从今天起要认真看这件事本身。

你写了很多年前端,每天都在发请求:`fetch('/api/orders')`、`axios.post(...)`。可你多半只关心「调用、拿到 JSON、渲染」,中间那一段,请求到底以什么形状在网络上跑、服务器那边怎么看见它,是被浏览器和库藏起来的。这门课接下来要写的东西,FastAPI 服务、调大模型的 API、MCP 服务器,说到底全是这一段。所以接下来三天专门拆开它,今天讲最前面的一半:地址怎么写,一次请求长什么样。

## 今天要解决的问题

学完今天,你应该能:

1. 把任意一个网址拆成**协议、主机、端口、路径、查询串、片段**六段,说得出每一段谁来看(浏览器还是服务器),并解释中文为什么会变成 `%E9%80%80`。
2. 打开 `curl -v`,指着输出说出**请求行、请求头、空行**各是哪几行;知道浏览器、curl、Python 发出的请求,本质上是同一种文字。
3. 说清 **GET 和 POST** 的区别(参数放哪、有没有 body、有没有 `Content-Length`),并用 curl 发出一个带查询参数的 GET 和一个带 body 的 POST。
4. 看到 `curl: (7) Failed to connect`、`zsh: no matches found` 这两种新手必踩的报错,知道病因。

预计用时:2.5 小时。前置:[Day 3](/blog/agent-zero/day-003-terminal-1/) 到 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的终端基本功、[Day 40](/blog/agent-zero/day-040-classes-1/) 到 [Day 42](/blog/agent-zero/day-042-classes-2/) 的类和继承(今天有一个很短的类要读)、前端的 Network 面板使用经验。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把「拆 URL 的脚本」和「用 curl 发 GET/POST 看服务器收到什么」默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不调大模型 API,花费 0 元。所有请求要么发给你自己电脑上的小服务器(`127.0.0.1`),要么是只读的 `http://example.com`(一个专门给人做演示的网站)。代码都放在 `agent-zero-lab/part01/` 里,在仓库根目录用 `uv run python part01/xxx.py` 运行。

环境说明:我这台 Mac 上 curl 是 `8.1.2`,Python 是 `3.12.13`。输出里家目录写成 `/Users/你`。我的终端设了代理环境变量,`curl -v` 的开头会多几行关于代理的信息,和今天的主题无关,下面贴输出时已经删掉(用 `--noproxy '*'` 可以绕开)。**没实跑的**:浏览器 DevTools 的界面(我没法截图操作,下面按 Chrome 官方文档和日常用法写),其余全部真跑。

## 从你熟悉的地方讲起:Network 面板里藏着什么

打开任意网页,F12,切到 Network(网络)面板,刷新。每一行是一次请求。点一行,右边出现的 Headers(标头)页签,最上面一块叫 General(常规),里面的字段你早就见过:

- `Request URL`:请求发往的完整地址。
- `Request Method`:方法,`GET`、`POST` 之类。
- `Status Code`:状态码,`200`、`404`……(后天讲)。

往下是 `Response Headers`(服务器回的头)和 `Request Headers`(浏览器发的头)。再往后还有 Payload(载荷)、Response(响应)页签。右键一行,Copy 菜单里有 **Copy as cURL**,会把这次请求原样变成一条 curl 命令,贴到终端就能重放。这一招后面会反复用到:想知道某个网站接口怎么调,先在浏览器里点一遍,再复制成 curl。

这些字段合起来,就是一次 HTTP 请求。今天要做的事,是把这个界面背后的真实内容用命令行看一遍。

**HTTP**(HyperText Transfer Protocol,超文本传输协议)是客户端和服务器之间「一问一答」的约定:客户端发一段**请求**,服务器回一段**响应**。**客户端**是发起的一方(浏览器、curl、你的 Python 脚本),**服务器**是接请求的一方。一次请求对应一次响应,没有「服务器主动找你」(那是后面才讲的别的机制)。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一问一答:左边是客户端(浏览器、curl、Python 脚本),右边是服务器。客户端发出请求(请求行、请求头、可选的 body),服务器回出响应(状态行、响应头、body)">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="170" height="120" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="101" y="64" text-anchor="middle" fill="var(--ink)">客户端</text>
<text x="101" y="88" text-anchor="middle" fill="var(--ink-soft)" font-size="11">浏览器 / curl</text>
<text x="101" y="108" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Python 脚本</text>
<text x="101" y="140" text-anchor="middle" fill="var(--ink-faint)" font-size="11">发起的一方</text>
<rect x="454" y="40" width="170" height="120" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="539" y="64" text-anchor="middle" fill="var(--ink)">服务器</text>
<text x="539" y="88" text-anchor="middle" fill="var(--ink-soft)" font-size="11">一个一直开着的程序</text>
<text x="539" y="108" text-anchor="middle" fill="var(--ink-soft)" font-size="11">监听某个端口</text>
<text x="539" y="140" text-anchor="middle" fill="var(--ink-faint)" font-size="11">接请求的一方</text>
<line x1="186" y1="80" x2="454" y2="80" stroke="var(--ink-soft)"/>
<text x="320" y="72" text-anchor="middle" fill="var(--ink)" font-size="11">请求:GET /hello HTTP/1.1 …</text>
<line x1="454" y1="124" x2="186" y2="124" stroke="var(--ink-soft)"/>
<text x="320" y="116" text-anchor="middle" fill="var(--ink)" font-size="11">响应:HTTP/1.1 200 OK …</text>
<text x="16" y="200" fill="var(--ink-faint)" font-size="11">一次请求对应一次响应;今天看请求,明后天看响应和请求体</text>
</g>
</svg>
<figcaption>HTTP 就是客户端发请求、服务器回响应的一问一答。</figcaption>
</figure>

## 第一步:一个 URL 拆成六段

**URL**(Uniform Resource Locator,统一资源定位符)就是网址。它不是一整块,而是有固定结构的几段。看一个云簿虚构的接口地址:

```text
https://api.cloudledger.example:8443/v1/invoices/search?status=unpaid&q=%E9%80%80%E6%AC%BE&limit=10#top
```

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="URL 的六段:协议 https,主机 api.cloudledger.example,端口 8443,路径 /v1/invoices/search,查询串 status=unpaid&q=…&limit=10,片段 top。片段不会发给服务器">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="10" y="30" width="56" height="32" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="38" y="51" text-anchor="middle" fill="var(--ink)">https</text>
<text x="76" y="51" fill="var(--ink-soft)">://</text>
<rect x="100" y="30" width="190" height="32" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="195" y="51" text-anchor="middle" fill="var(--ink)">api.cloudledger.example</text>
<text x="292" y="51" fill="var(--ink-soft)">:</text>
<rect x="302" y="30" width="46" height="32" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="325" y="51" text-anchor="middle" fill="var(--ink)">8443</text>
<rect x="352" y="30" width="154" height="32" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="429" y="51" text-anchor="middle" fill="var(--ink)">/v1/invoices/search</text>
<text x="510" y="51" fill="var(--ink-soft)">?</text>
<rect x="522" y="30" width="108" height="32" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="576" y="51" text-anchor="middle" fill="var(--ink)">status=…&amp;…</text>
<text x="38" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">协议</text>
<text x="195" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">主机</text>
<text x="325" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">端口</text>
<text x="429" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">路径</text>
<text x="576" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">查询串</text>
<text x="38" y="106" text-anchor="middle" fill="var(--ink-faint)" font-size="11">怎么说</text>
<text x="195" y="106" text-anchor="middle" fill="var(--ink-faint)" font-size="11">找谁</text>
<text x="325" y="106" text-anchor="middle" fill="var(--ink-faint)" font-size="11">哪个门</text>
<text x="429" y="106" text-anchor="middle" fill="var(--ink-faint)" font-size="11">要什么</text>
<text x="576" y="106" text-anchor="middle" fill="var(--ink-faint)" font-size="11">条件</text>
<text x="16" y="150" fill="var(--ink)" font-size="12">最后还有 #top:片段(fragment),只给浏览器用,不会发给服务器</text>
<text x="16" y="174" fill="var(--ink-soft)" font-size="11">浏览器发出的是:GET /v1/invoices/search?status=unpaid&amp;q=… HTTP/1.1,加上 Host 头</text>
<text x="16" y="194" fill="var(--ink-soft)" font-size="11">协议、主机、端口决定「连到哪里」,路径和查询串决定「向它要什么」</text>
</g>
</svg>
<figcaption>六段里前三段决定「连到哪台机器的哪个门」,路径和查询串决定「要什么」,片段留在浏览器。</figcaption>
</figure>

逐段看:

- **协议(scheme)**:`https`。说话的方式,`http` 是明文,`https` 是加了密的 HTTP(多一层加密,请求的内容别人偷看不了)。
- **主机(host)**:`api.cloudledger.example`。找哪台机器,可以是域名,也可以是 IP(`127.0.0.1` 永远指你自己这台电脑)。`.example` 是专门留给演示的后缀,不会真的存在。
- **端口(port)**:`8443`。一台机器上同时跑着很多服务,端口是门牌号。`http` 默认 80、`https` 默认 443,用默认的时候地址里就不写(所以你平时见的网址没有端口)。
- **路径(path)**:`/v1/invoices/search`。服务器上你要的是哪个资源,像文件路径。
- **查询串(query)**:`?` 后面,`status=unpaid&q=…&limit=10`。一串「键=值」,用 `&` 隔开,给路径补充条件。
- **片段(fragment)**:`#top`。页面里跳到哪个位置,**浏览器自己处理,不会发给服务器**,这一点后面会实测。

用 Python 标准库拆一遍。新建 `agent-zero-lab/part01/url_parts.py`:

```python
# agent-zero-lab/part01/url_parts.py
from urllib.parse import parse_qs, quote, unquote, urlsplit

URL = "https://api.cloudledger.example:8443/v1/invoices/search?status=unpaid&q=%E9%80%80%E6%AC%BE&limit=10#top"

parts = urlsplit(URL)
print("scheme  :", parts.scheme)
print("host    :", parts.hostname)
print("port    :", parts.port)
print("path    :", parts.path)
print("query   :", parts.query)
print("fragment:", parts.fragment)

print("--- 没写端口的网址 ---")
print(urlsplit("https://example.com/docs").port)
print(urlsplit("http://example.com/docs").port)

print("--- query 拆成字典 ---")
params = parse_qs(parts.query)
print(params)
print("q 解码后:", params["q"][0])

print("--- 百分号编码 ---")
print(quote("退款 3 天"))
print(unquote("%E9%80%80%E6%AC%BE"))
```

<div class="line-notes">

- `from urllib.parse import parse_qs, quote, unquote, urlsplit` `urllib.parse` 是 Python 自带的「处理网址」的模块,不用装。相当于 JS 里的 `URL` 和 `URLSearchParams`。四个名字:`urlsplit` 拆网址,`parse_qs` 把查询串拆成字典,`quote`/`unquote` 编码和解码。
- `URL = "https://api.cloudledger.example:8443/v1/invoices/search?status=unpaid` 就是上面那个例子。里面的 `%E9%80%80%E6%AC%BE` 是「退款」两个字编码后的样子,马上解释。
- `parts = urlsplit(URL)` 拆成一个有属性的对象。`parts.scheme` 是 `https`,后面每个属性对应一段。
- `print("host    :", parts.hostname)` `hostname` 是不带端口的主机名,`api.cloudledger.example`。
- `print("port    :", parts.port)` 地址里写了 `:8443`,这里是整数 `8443`。
- `print("query   :", parts.query)` `?` 后面、`#` 前面的那一段原样字符串,还没拆。
- `print("fragment:", parts.fragment)` `#` 后面,`top`。
- `print(urlsplit("https://example.com/docs").port)` 没写端口,结果是 `None`:这个库不替你补默认值,默认值(443、80)是浏览器和 curl 自己知道的。
- `params = parse_qs(parts.query)` 把 `status=unpaid&q=…&limit=10` 拆成字典。注意值是**列表**,因为同一个键可以出现多次(练习 1 会看到)。
- `print("q 解码后:", params["q"][0])` `params["q"]` 是 `['退款']`,取第一个元素,`parse_qs` 已经帮你把 `%E9%80%80%E6%AC%BE` 还原成了「退款」。
- `print(quote("退款 3 天"))` 反过来:把字符串编码成能放进网址的形式。「退」变成 `%E9%80%80`,空格变成 `%20`。
- `print(unquote("%E9%80%80%E6%AC%BE"))` 解码回「退款」。

</div>

运行:

```bash
cd ~/agent-zero-lab
uv run python part01/url_parts.py
```

实测输出:

```text
scheme  : https
host    : api.cloudledger.example
port    : 8443
path    : /v1/invoices/search
query   : status=unpaid&q=%E9%80%80%E6%AC%BE&limit=10
fragment: top
--- 没写端口的网址 ---
None
None
--- query 拆成字典 ---
{'status': ['unpaid'], 'q': ['退款'], 'limit': ['10']}
q 解码后: 退款
--- 百分号编码 ---
%E9%80%80%E6%AC%BE%203%20%E5%A4%A9
退款
```

### 为什么中文变成了 %E9%80%80

网址里只允许一小撮字符(字母、数字、少数符号),中文、空格、`&` 这些都不能直接放。规则是:先把字符转成 UTF-8 的**字节**,再把每个字节写成 `%` 加两位十六进制。「退」这个字的 UTF-8 是三个字节 `E9 80 80`,所以变成 `%E9%80%80`,「款」同理。这叫**百分号编码**(percent-encoding,也叫 URL 编码)。你在 Network 面板里偶尔看到一串 `%E4%BD%A0`,就是中文。前端的 `encodeURIComponent` 做的是同一件事。

输出最后两行里有个值得记的细节:空格被编成 `%20`。还有一种写法是 `+`(`urlencode` 会用,稍后会碰到),在查询串里两种都认。

## 第二步:一次请求到底长什么样

现在看真的请求。找一个公共的、只读的、专门拿来试的地址 `http://example.com`,让 curl 把请求和响应都打印出来(`-v` 是 verbose,啰嗦模式;`--http1.1` 强制用 HTTP/1.1,它是纯文本,方便你看;`-o /dev/null` 把网页内容丢掉,只看通信):

```bash
curl -v --http1.1 --noproxy '*' http://example.com -o /dev/null
```

<div class="line-notes">

- `curl -v --http1.1 --noproxy '*' http://example.com -o /dev/null` `-v` 让 curl 把发出和收到的东西都显示出来;`--http1.1` 指定协议版本,HTTP/2 是二进制的,看不到文字;`--noproxy '*'` 是我这边为了绕开自己的代理加的,你不用写;`-o /dev/null` 把响应内容写进「黑洞」(Day 5 讲过),屏幕只留通信过程。注意地址是 `http` 不是 `https`:`https` 会先做一轮加密握手,那一段暂时不讲,先看明文。

</div>

我挑出和今天有关的行(响应头我只留了一条,真实输出里还有十几条,`Date`、`CF-RAY` 之类每次不同):

```text
* Trying 104.20.23.154:80...
* Connected to example.com (104.20.23.154) port 80 (#0)
> GET / HTTP/1.1
> Host: example.com
> User-Agent: curl/8.1.2
> Accept: */*
> 
< HTTP/1.1 200 OK
< Date: Fri, 23 Oct 2026 04:02:55 GMT
< Content-Type: text/html; charset=utf-8
< 
```

<div class="line-notes">

- `* Trying 104.20.23.154:80...` 以 `*` 开头的是 curl 自己的说明。它先把域名 `example.com` 查成 IP(这一步叫 DNS 解析,不展开),然后连到这个 IP 的 80 端口(`http` 的默认端口)。
- `* Connected to example.com (104.20.23.154) port 80 (#0)` 连上了。到这里还没发任何 HTTP 内容,只是接通了线。
- `> GET / HTTP/1.1` 以 `>` 开头的是**你发出去的**。这一行叫**请求行**:方法 `GET`,路径 `/`(没写路径就是根路径),协议版本 `HTTP/1.1`。
- `> Host: example.com` 第一个请求头。同一台机器(同一个 IP)上可能托管着几千个网站,服务器靠 `Host` 知道你要的是哪一个。所以**你在地址栏写的主机名,有一份会放进这里**。HTTP/1.1 要求必须带。
- `> User-Agent: curl/8.1.2` 自报家门:「我是 curl 8.1.2」。浏览器在这里写的是一长串 `Mozilla/5.0 (Macintosh; ...) Chrome/...`。
- `> Accept: */*` 「我什么类型的内容都接受」。
- `> ` 请求头结束后的一个**空行**(这一行只有 `>`,什么也没有)。空行的意思是「头写完了」。GET 没有 body,所以请求到这里就结束了。
- `< HTTP/1.1 200 OK` 以 `<` 开头的是**服务器回的**。第一行叫**状态行**:协议版本,状态码 `200`,原因短语 `OK`。状态码明天专门讲。
- `< Content-Type: text/html; charset=utf-8` 响应头之一,告诉你内容是 HTML、用 UTF-8 编码。
- `< ` 响应头后面也有空行,再后面才是响应的 body(网页本身,被我们丢进了 `/dev/null`)。

</div>

这几行就是 HTTP/1.1 的全部形状。换成示意图:

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="一次 HTTP 请求的文字结构:第一行请求行(方法、路径、协议版本),接着若干行请求头(键: 值),然后一个空行,GET 到此结束,POST 在空行后面还有 body">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="360" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="40" fill="var(--ink)">GET /search?q=refund HTTP/1.1</text>
<rect x="16" y="50" width="360" height="78" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="70" fill="var(--ink)">Host: 127.0.0.1:8765</text>
<text x="28" y="90" fill="var(--ink)">User-Agent: curl/8.1.2</text>
<text x="28" y="110" fill="var(--ink)">Accept: */*</text>
<rect x="16" y="128" width="360" height="22" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="28" y="144" fill="var(--ink-faint)" font-size="11">(空行)</text>
<rect x="16" y="150" width="360" height="40" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="28" y="174" fill="var(--ink-faint)" font-size="11">body:GET 通常没有;POST 在这里</text>
<text x="396" y="40" fill="var(--ink)" font-size="12">请求行</text>
<text x="396" y="56" fill="var(--ink-soft)" font-size="11">方法  路径+查询串  协议版本</text>
<text x="396" y="92" fill="var(--ink)" font-size="12">请求头</text>
<text x="396" y="108" fill="var(--ink-soft)" font-size="11">每行「名字: 值」,后天细讲</text>
<text x="396" y="144" fill="var(--ink)" font-size="12">空行</text>
<text x="396" y="160" fill="var(--ink-soft)" font-size="11">「头结束了」的标志</text>
<text x="396" y="182" fill="var(--ink)" font-size="12">body</text>
<text x="396" y="198" fill="var(--ink-soft)" font-size="11">Day 61 细讲</text>
<text x="16" y="224" fill="var(--ink-faint)" font-size="11">每行以回车换行结尾(\r\n),这是 HTTP 的规定</text>
</g>
</svg>
<figcaption>请求就是一小段结构固定的文字:一行请求行,若干行请求头,一个空行,有的请求后面还跟一段 body。</figcaption>
</figure>

浏览器发的请求和这个没有本质区别,只是请求头更多(`Cookie`、`Accept-Language`……)。**你在 Network 面板里点开的 Request Headers,就是上面 `>` 开头的那一批行。**

## 第三步:自己搭一个「收件箱」,看服务器收到了什么

curl 的 `-v` 能看到你发了什么,但最有说服力的是站在**接收方**看。我们写一个很小的服务器,收到请求就把它的内容打印出来,不管发来的是 curl、Python 还是浏览器。

**服务器**说白了是一个一直运行的程序,告诉操作系统「我在某个端口等着」,有人连进来,就读他发来的那段文字,处理,再回一段文字。它没有任何神秘之处。Python 标准库自带一个现成的 `http.server`,帮你处理了「读请求、拆文字」这些琐事,你只要告诉它「收到 GET 做什么、收到 POST 做什么」。对你的前端经验来说,它相当于 Node 里的 `http.createServer((req, res) => ...)`:`self.path` 对应 `req.url`,`self.headers` 对应 `req.headers`,`self.wfile.write` 对应 `res.end`。

新建 `agent-zero-lab/part01/echo_server.py`:

```python
# agent-zero-lab/part01/echo_server.py
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 8765


class EchoHandler(BaseHTTPRequestHandler):
    def _show(self, body: bytes) -> None:
        print("=" * 48)
        print("请求行:", self.requestline)
        print("--- header ---")
        for name, value in self.headers.items():
            print(f"{name}: {value}")
        print("--- body ---")
        print(repr(body.decode()) if body else "(没有 body)", flush=True)

    def _reply(self, text: str) -> None:
        data = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._show(b"")
        self._reply(f"你发的是 GET {self.path}\n")

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self._show(body)
        self._reply(f"你发的是 POST {self.path},body 有 {len(body)} 字节\n")

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},Ctrl+C 退出", flush=True)
    HTTPServer((HOST, PORT), EchoHandler).serve_forever()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` 两个现成的零件:`HTTPServer` 是「一直监听端口的那个循环」,`BaseHTTPRequestHandler` 是「每来一个请求,怎么处理」的半成品。
- `HOST = "127.0.0.1"` 只监听本机。`127.0.0.1` 是回环地址,只有你这台电脑自己能连上,别人(同一个 Wi-Fi 下的人)连不到,**自己写着玩的服务器一定要这么设**。
- `PORT = 8765` 随便挑的门牌号。1024 以下要管理员权限,别用;如果你的 8765 恰好被占用,换一个就行,下面所有命令里的端口一起换。
- `class EchoHandler(BaseHTTPRequestHandler):` 继承([Day 42](/blog/agent-zero/day-042-classes-2/) 讲过):拿官方的半成品,补我们自己的方法。每来一个请求,`HTTPServer` 就新建一个 `EchoHandler`,按请求里的方法名去找 `do_方法名`。
- `def _show(self, body: bytes) -> None:` 前面带下划线是约定「内部用」。把收到的请求打印出来。`body: bytes` 表示 body 是字节串(不是字符串,因为网线上传的永远是字节)。
- `print("=" * 48)` 一条分隔线,48 个等号,区分每次请求。
- `print("请求行:", self.requestline)` `self.requestline` 是库帮你读出来的第一行。比如 `GET /hello HTTP/1.1`。
- `for name, value in self.headers.items():` `self.headers` 装着所有请求头,`items()` 逐个取出「名字、值」(Day 24 的字典用法)。
- `print(f"{name}: {value}")` 按原样格式打印每一行头,比如 `Host: 127.0.0.1:8765`。
- `print(repr(body.decode()) if body else "(没有 body)", flush=True)` 有 body 就把字节解码成字符串再用 `repr` 打印(带引号,看得出边界),没有就写「没有 body」。`flush=True` 让输出立刻出现在终端,不被缓冲。
- `def _reply(self, text: str) -> None:` 回一个响应。
- `data = text.encode()` 字符串转字节(默认 UTF-8)。`"你发的是 GET /hello\n"` 里有中文,转成字节后长度比字符数大,所以下面要用字节数。
- `self.send_response(200)` 写响应的状态行:`HTTP/1.0 200 OK`。后天讲 200 的含义。
- `self.send_header("Content-Type", "text/plain; charset=utf-8")` 写一个响应头:内容是纯文本,UTF-8。
- `self.send_header("Content-Length", str(len(data)))` 再写一个头:内容有多少字节。比如 `你发的是 GET /hello\n` 是 24 字节(中文每字 3 字节),客户端靠它知道读多少。
- `self.end_headers()` 写那个**空行**,表示头写完了。
- `self.wfile.write(data)` 把响应内容写出去,`wfile` 是「写给客户端的那根管子」。
- `def do_GET(self) -> None:` 收到 `GET` 请求就调用它。方法名是固定的约定:`do_` 加大写的 HTTP 方法。
- `self._show(b"")` GET 没有 body,传一个空字节串 `b""`。
- `self._reply(f"你发的是 GET {self.path}\n")` `self.path` 是请求行里的路径**连同查询串**,比如 `/search?q=refund&page=2`。
- `def do_POST(self) -> None:` 收到 `POST` 请求的处理。
- `length = int(self.headers.get("Content-Length", "0"))` body 有多长?请求头 `Content-Length` 说了(字符串),转成整数。没有这个头就当 0。
- `body = self.rfile.read(length)` `rfile` 是「从客户端读的那根管子」,按头里说的长度读出 body。读多了会卡住等待,所以必须按长度读。
- `self._show(body)` / `self._reply(...)` 打印并回复,回复里带上 body 的字节数。
- `def log_message(self, format: str, *args: object) -> None:` `pass` 把库默认的每次请求日志关掉,让终端里只有我们自己的打印。
- `if __name__ == "__main__":` 只有直接运行这个文件时才往下执行,被别的文件 `import` 的时候不会启动服务器。
- `HTTPServer((HOST, PORT), EchoHandler).serve_forever()` 在 `127.0.0.1:8765` 开始监听,每个请求交给 `EchoHandler`;`serve_forever` 是永远循环,所以程序不会自己结束,要按 `Ctrl+C`。

</div>

开两个终端窗口。**终端 1**(服务器):

```bash
cd ~/agent-zero-lab
uv run python part01/echo_server.py
```

实测输出,然后光标停住不动,这就是服务器在等:

```text
监听 http://127.0.0.1:8765,Ctrl+C 退出
```

**终端 2**(客户端)里的命令都在 `agent-zero-lab` 里敲。先发最简单的一个:

```bash
curl -s http://127.0.0.1:8765/hello
```

(`-s` 是 silent,不显示进度条;在真终端里直接敲不加 `-s` 也不会有进度条,我是在脚本里跑的才加。)终端 2 实测输出:

```text
你发的是 GET /hello
```

终端 1 的服务器同时打印了:

```text
================================================
请求行: GET /hello HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
Accept: */*
--- body ---
(没有 body)
```

这就是服务器**真正看到**的东西:请求行一条、三个请求头、没有 body。和上面 `curl -v` 里 `>` 开头的行一模一样。`Host: 127.0.0.1:8765` 里带着端口,因为地址里写了端口。

## 第四步:GET,参数放在地址里

GET 的意思是「给我这个东西」。想让服务器知道更多条件,就把它们放在**查询串**里。

```bash
curl -s "http://127.0.0.1:8765/search?q=refund&page=2"
curl -s -H "X-Debug: 1" -H "Accept: application/json" http://127.0.0.1:8765/hello
```

<div class="line-notes">

- `curl -s "http://127.0.0.1:8765/search?q=refund&page=2"` **整个地址一定要加引号**。`?` 和 `&` 对终端 shell 有特殊含义,不加引号会出事(下面「常见报错」会实测)。路径是 `/search`,查询串是 `q=refund&page=2`,两个参数。
- `curl -s -H "X-Debug: 1" -H "Accept: application/json" http://127.0.0.1:8765/hello` `-H` 是 header,**自己加一个请求头**,格式是 `"名字: 值"`。可以写多个。`X-Debug` 是我随手起的名字,以 `X-` 开头表示自定义头。写了 `Accept` 之后,curl 默认的 `Accept: */*` 就被替换了。

</div>

终端 2 的输出:

```text
你发的是 GET /search?q=refund&page=2
你发的是 GET /hello
```

终端 1 对应的两块:

```text
================================================
请求行: GET /search?q=refund&page=2 HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
Accept: */*
--- body ---
(没有 body)
```

```text
================================================
请求行: GET /hello HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
X-Debug: 1
Accept: application/json
--- body ---
(没有 body)
```

看第一块:`q=refund&page=2` 作为请求行里路径的一部分原样到了服务器,**参数就在请求行里**,没有 body。第二块:你加的 `X-Debug: 1` 原样出现,`Accept` 变成了你写的 `application/json`。请求头就是这么一回事:客户端愿意写什么,服务器就能看到什么。

前面说过**片段(`#`后面)不发给服务器**,验证一下:

```bash
curl -s "http://127.0.0.1:8765/page?x=1#top"
```

服务器那边的请求行是:

```text
请求行: GET /page?x=1 HTTP/1.1
```

`#top` 不见了。curl 在发出前就把它去掉了,浏览器也是。所以单页应用里 `#/orders` 这种路由,服务器根本不知道。

## 第五步:POST,参数放在 body 里

**POST** 的意思是「我要交给你一份东西」,比如提交表单、创建订单、让服务器做一件事。这份东西放在**请求体(body)**里,跟在空行后面。

```bash
curl -s -d "name=云簿&plan=team" http://127.0.0.1:8765/signup
curl -s -X POST http://127.0.0.1:8765/ping
```

<div class="line-notes">

- `curl -s -d "name=云簿&plan=team" http://127.0.0.1:8765/signup` `-d` 是 data:带上一段 body,**curl 看到 `-d` 就自动把方法改成 POST**,所以不用再写 `-X POST`。body 的内容是 `name=云簿&plan=team`。引号同样不能省,里面有 `&`。
- `curl -s -X POST http://127.0.0.1:8765/ping` `-X` 是指定方法。这里**只改方法,不带 body**,用来对比。

</div>

终端 2:

```text
你发的是 POST /signup,body 有 21 字节
你发的是 POST /ping,body 有 0 字节
```

终端 1 的两块:

```text
================================================
请求行: POST /signup HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
Accept: */*
Content-Length: 21
Content-Type: application/x-www-form-urlencoded
--- body ---
'name=云簿&plan=team'
```

```text
================================================
请求行: POST /ping HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
Accept: */*
--- body ---
(没有 body)
```

对比 GET,POST 多了三样东西:

- **请求行的方法变成了 `POST`**。
- **多了两个请求头**:`Content-Length: 21` 说 body 有 21 字节,`Content-Type: application/x-www-form-urlencoded` 说 body 是「键=值&键=值」这种表单格式。(`Content-Type` 是 Day 61 的主角,今天只认识它。)
- **空行后面多了 body**:`name=云簿&plan=team`。

数一下为什么是 21:`name=` 5 个字符、`云簿` 两个汉字、`&plan=team` 10 个字符,共 17 个字符,但中文在 UTF-8 里每个字占 3 个字节,两个汉字多出 4 字节,所以是 5 + 6 + 10 = 21 字节。**`Content-Length` 数的是字节,不是字符**,服务器照这个数字读 body,所以它必须准。

第二条 `-X POST` 没有 body,所以头里**没有** `Content-Length` 和 `Content-Type`,服务器那边 `self.headers.get("Content-Length", "0")` 取到默认的 `"0"`,body 为空。方法和 body 是两回事,方法写 POST 不代表一定有 body。

想让 curl 帮你把值编码好,用 `--data-urlencode`:

```bash
curl -s --data-urlencode "q=退款 3 天" http://127.0.0.1:8765/search
```

服务器看到的 body 是 `'q=%E9%80%80%E6%AC%BE+3+%E5%A4%A9'`,`Content-Length: 32`。中文变成百分号编码,空格变成了 `+`。

### GET 和 POST 的区别,一张表

| | GET | POST |
| --- | --- | --- |
| 意思 | 要一个东西 | 交一份东西,让服务器做事 |
| 参数放哪 | 地址里(查询串) | body 里 |
| 有没有 body | 通常没有 | 通常有 |
| 多出的请求头 | 无 | `Content-Length`、`Content-Type` |
| 能不能当链接点、存书签 | 能 | 不能(没法把 body 存进地址) |
| 参数会不会留在日志里 | 会(地址常被日志记录) | body 一般不记 |

最后一行很关键:**密码、token、个人信息别放在 GET 的查询串里**,地址会被浏览器历史、服务器日志、代理原样记下来。大模型的 API 调用都是 POST,body 里放 messages,原因就在这。

### 方法只是一个约定:试试 HEAD

HTTP 还有别的方法,先看一张清单,以后每个都会遇到:

| 方法 | 一般的意思 |
| --- | --- |
| GET | 取一个资源 |
| POST | 提交数据、创建、触发动作 |
| PUT | 整个替换一个资源 |
| PATCH | 只改资源的一部分 |
| DELETE | 删除资源 |
| HEAD | 和 GET 一样,但只要响应头,不要 body |
| OPTIONS | 问「这个地址允许哪些方法」(你在前端见过的 CORS 预检请求就是它) |

「一般的意思」是约定,服务器想怎么处理是它的自由。我们的小服务器只写了 `do_GET` 和 `do_POST`,用 `-I`(发 HEAD 请求)试试:

```bash
curl -s -I http://127.0.0.1:8765/hello
```

实测输出:

```text
HTTP/1.0 501 Unsupported method ('HEAD')
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 04:03:52 GMT
Connection: close
Content-Type: text/html;charset=utf-8
Content-Length: 357
```

服务器回了 `501 Unsupported method ('HEAD')`:「这个方法我没实现」。终端 1 什么也没打印,因为我们没写 `do_HEAD`,`_show` 根本没被调用。方法名只是一个词,有没有对应的处理由服务器决定。`501` 是状态码,后天讲。

## 第六步:Python 发出的请求,和 curl 有什么区别

前面一直用 curl 当客户端。你以后在 Python 里调 API,发出去的也是同一种文字。验证一下。新建 `agent-zero-lab/part01/send_urllib.py`(服务器还开着):

```python
# agent-zero-lab/part01/send_urllib.py
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8765"

with urlopen(f"{BASE}/from-python?lang=py") as resp:
    print(resp.status, resp.read().decode().strip())

req = Request(f"{BASE}/signup", data="name=云簿".encode(), method="POST")
with urlopen(req) as resp:
    print(resp.status, resp.read().decode().strip())
```

<div class="line-notes">

- `from urllib.request import Request, urlopen` 标准库里的「发请求」模块,`urlopen` 是最简单的发送函数,`Request` 用来构造更复杂的请求。后面几天会换成更好用的第三方库 `httpx`,但底层发的是同样的东西。
- `BASE = "http://127.0.0.1:8765"` 服务器地址,和 `echo_server.py` 里的对应。
- `with urlopen(f"{BASE}/from-python?lang=py") as resp:` 发一个 GET。`with` 保证用完自动关连接([Day 38](/blog/agent-zero/day-038-files-with/) 讲过)。拼出来的地址是 `http://127.0.0.1:8765/from-python?lang=py`。
- `print(resp.status, resp.read().decode().strip())` `resp.status` 是状态码 `200`;`resp.read()` 读出响应内容(字节),`decode()` 转字符串,`strip()` 去掉末尾换行。
- `req = Request(f"{BASE}/signup", data="name=云簿".encode(), method="POST")` 构造一个 POST:`data` 是 body,必须是字节,所以 `"name=云簿".encode()`,共 5 + 6 = 11 字节;`method="POST"` 指定方法。
- `with urlopen(req) as resp:` 发出去。第二行 `print` 同理。

</div>

运行(终端 2):

```bash
uv run python part01/send_urllib.py
```

终端 2 输出:

```text
200 你发的是 GET /from-python?lang=py
200 你发的是 POST /signup,body 有 11 字节
```

终端 1 的两块:

```text
================================================
请求行: GET /from-python?lang=py HTTP/1.1
--- header ---
Accept-Encoding: identity
Host: 127.0.0.1:8765
User-Agent: Python-urllib/3.12
Connection: close
--- body ---
(没有 body)
```

```text
================================================
请求行: POST /signup HTTP/1.1
--- header ---
Accept-Encoding: identity
Content-Type: application/x-www-form-urlencoded
Content-Length: 11
Host: 127.0.0.1:8765
User-Agent: Python-urllib/3.12
Connection: close
--- body ---
'name=云簿'
```

对照 curl 的:请求行的形状一模一样;区别只在请求头里:`User-Agent` 是 `Python-urllib/3.12`,多了 `Accept-Encoding: identity` 和 `Connection: close`。**curl、Python、浏览器,是三个不同的客户端,发出去的是同一种文字,服务器靠 `User-Agent` 这样的头认出你是谁。** 这也解释了为什么有的网站拒绝爬虫:它看 `User-Agent`。注意第二个请求里,Python 在你没写 `Content-Type` 的时候,和 curl 一样自动补了 `application/x-www-form-urlencoded`。

用完了,回终端 1 按 `Ctrl+C` 关掉服务器。

## 三个新手必踩的报错

**一、服务器没开,`Connection refused`。** 关掉服务器后再发一次请求:

```bash
curl -sS http://127.0.0.1:8765/hello
echo "exit=$?"
uv run python part01/send_urllib.py
```

实测输出(Python 的 Traceback 只留最后几行,路径缩短):

```text
curl: (7) Failed to connect to 127.0.0.1 port 8765 after 11 ms: Couldn't connect to server
exit=7
```

```text
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/urllib/request.py", line 1347, in do_open
    raise URLError(err)
urllib.error.URLError: <urlopen error [Errno 61] Connection refused>
```

curl 的 `(7)` 是退出码 7,意思是「连不上」(`-sS` 是静默但保留错误信息,只用 `-s` 的话连错误也看不到,只能靠 `echo $?` 发现是 7)。Python 里是 `Connection refused`,`[Errno 61]` 是 macOS 的错误编号。原因都是同一个:**那个端口上没有程序在听**,要么服务器没启动,要么端口号写错了。前端调后端接口时,浏览器里看到的 `net::ERR_CONNECTION_REFUSED` 是同一个问题。

**二、地址没加引号,zsh 报 `no matches found`。** macOS 默认的 shell 是 zsh,它把 `?` 当成通配符(Day 4 讲通配符时说过 `*`,`?` 是它的兄弟,匹配任意一个字符)。地址里有 `?` 又不加引号,zsh 想按通配符去找文件,找不到就直接报错,**curl 根本没有运行**:

```bash
curl -s http://127.0.0.1:8765/search?q=refund&page=2
```

实测输出:

```text
zsh:1: no matches found: http://127.0.0.1:8765/search?q=refund
```

注意报错里的地址在 `&` 前面就断了,这引出第三个问题。

**三、`&` 把命令截断了。** `&` 在终端里的意思是「把前面的命令放到后台运行」,所以 `http://…/search?q=refund&page=2` 被 shell 理解成两件事:一是发 `http://…/search?q=refund`,二是执行一个叫 `page=2` 的东西。我关掉 zsh 的通配符检查(`noglob`)重现一次:

```bash
noglob curl -s http://127.0.0.1:8765/search?q=refund&page=2
```

服务器那边收到的请求行是:

```text
请求行: GET /search?q=refund HTTP/1.1
```

`page=2` 丢了。**这个 bug 最阴险,不报错,只是参数悄悄少了。** 解决办法一条:地址永远用引号括起来,单引号双引号都行。

## 一张表:今天的东西放在哪

| 想传的东西 | 放在请求的哪里 | 例子 |
| --- | --- | --- |
| 要哪个资源 | 路径 | `/v1/invoices/search` |
| 筛选、分页之类的条件 | 查询串(GET 常用) | `?status=unpaid&limit=10` |
| 要提交的数据 | body(POST 常用) | `name=云簿&plan=team` |
| 我是谁、我想要什么格式、我的凭证 | 请求头 | `User-Agent`、`Accept`、`Authorization` |
| 找哪个网站 | `Host` 头(来自地址里的主机) | `Host: example.com` |

## 零件对照表

| 零件 | 做什么 | 在哪里用到 |
| --- | --- | --- |
| `urlsplit` | 把网址拆成 scheme/hostname/port/path/query/fragment | `url_parts.py`、练习 1 |
| `parse_qs` | 把查询串拆成字典(值是列表) | `url_parts.py`、练习 1、5 |
| `quote` / `unquote` | 百分号编码和解码 | `url_parts.py` |
| `curl -v` | 打印发出(`>`)和收到(`<`)的每一行 | 第二步 |
| `curl -H "名: 值"` | 加请求头 | 第四步、练习 2 |
| `curl -d` / `--data-urlencode` | 带 body,自动变成 POST | 第五步、练习 3 |
| `curl -X 方法` | 指定方法 | 第五步 |
| `curl -I` | 发 HEAD 请求 | 第五步 |
| `curl -A` | 改 `User-Agent` | 练习 2 |
| `BaseHTTPRequestHandler` + `do_GET`/`do_POST` | 写一个只处理 GET/POST 的小服务器 | `echo_server.py` |
| `urlopen` / `Request` | Python 标准库发请求 | `send_urllib.py` |
| `urlencode` | 把字典编成查询串 | 练习 5 |

## 动手练习

### 练习 1:拆一个更复杂的地址

写 `part01/ex59_url.py`,拆这个地址:`http://localhost:3000/api/v2/users/42/orders?status=paid&status=refunded&page=2#section-3`。打印六段,再打印 `parse_qs` 的结果。回答:`status` 出现了两次,字典里是什么样?这个请求发给服务器时,请求行是什么?`#section-3` 服务器收得到吗?

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex59_url.py
from urllib.parse import parse_qs, urlsplit

URL = "http://localhost:3000/api/v2/users/42/orders?status=paid&status=refunded&page=2#section-3"

parts = urlsplit(URL)
print("scheme  :", parts.scheme)
print("host    :", parts.hostname)
print("port    :", parts.port)
print("path    :", parts.path)
print("query   :", parts.query)
print("fragment:", parts.fragment)
print(parse_qs(parts.query))
```

<div class="line-notes">

- `from urllib.parse import parse_qs, urlsplit` 这次只需要两个。
- `URL = "http://localhost:3000/api/v2/users/42/orders?status=paid` 地址里 `3000` 是端口,`localhost` 是主机名(指你自己这台电脑,和 `127.0.0.1` 等价),查询串里有重复的键 `status`。
- `parts = urlsplit(URL)` 拆开。
- `print("port    :", parts.port)` 这里写了端口,所以不是 `None`,而是整数 `3000`。
- `print("fragment:", parts.fragment)` `section-3`。
- `print(parse_qs(parts.query))` 重复的键被收进同一个列表。

</div>

运行 `uv run python part01/ex59_url.py`,实测输出:

```text
scheme  : http
host    : localhost
port    : 3000
path    : /api/v2/users/42/orders
query   : status=paid&status=refunded&page=2
fragment: section-3
{'status': ['paid', 'refunded'], 'page': ['2']}
```

`status` 的值是列表 `['paid', 'refunded']`,这就是 `parse_qs` 的值总是列表的原因。发给服务器的请求行是 `GET /api/v2/users/42/orders?status=paid&status=refunded&page=2 HTTP/1.1`,外加 `Host: localhost:3000`。`#section-3` 收不到:服务器开着(练习用的 echo 服务器)时我发了 `curl -s "http://127.0.0.1:8765/page?x=1#top"`,服务器那边的请求行是 `GET /page?x=1 HTTP/1.1`,片段已被去掉。

</details>

### 练习 2:读 curl -v,自己改请求头

启动 `echo_server.py`。用 `curl -v` 请求 `http://127.0.0.1:8765/echo?a=1&b=2`,同时用 `-A` 把 `User-Agent` 改成 `MyBot/1.0`,再加一个自定义头 `X-Student: learner`。回答:请求行是什么?哪些头是你加的、哪些是 curl 自己加的?服务器那边看到了什么?

<details>
<summary>参考答案</summary>

```bash
curl -v -A "MyBot/1.0" -H "X-Student: learner" "http://127.0.0.1:8765/echo?a=1&b=2"
```

<div class="line-notes">

- `curl -v -A "MyBot/1.0" -H "X-Student: learner" "http://127.0.0.1:8765/echo?a=1&b=2"` `-v` 打印通信过程;`-A` 是 user-agent 的快捷写法,等于 `-H "User-Agent: MyBot/1.0"`;`-H` 加自定义头;地址带引号,因为里面有 `?` 和 `&`。

</div>

实测输出(`>` 和 `<` 开头的行,以及正文):

```text
> GET /echo?a=1&b=2 HTTP/1.1
> Host: 127.0.0.1:8765
> User-Agent: MyBot/1.0
> Accept: */*
> X-Student: learner
> 
< HTTP/1.0 200 OK
< Server: BaseHTTP/0.6 Python/3.12.13
< Date: Fri, 23 Oct 2026 04:08:21 GMT
< Content-Type: text/plain; charset=utf-8
< Content-Length: 31
< 
你发的是 GET /echo?a=1&b=2
```

服务器终端:

```text
================================================
请求行: GET /echo?a=1&b=2 HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: MyBot/1.0
Accept: */*
X-Student: learner
--- body ---
(没有 body)
```

请求行是 `GET /echo?a=1&b=2 HTTP/1.1`。**你加的**:`User-Agent`(改了值)、`X-Student`。**curl 自己加的**:`Host`(从地址里取的)、`Accept: */*`。服务器看到的和 `>` 开头的行完全一致:`-v` 里你看到的发出去的东西,就是服务器收到的东西。响应那边,`Content-Length: 31` 是 `你发的是 GET /echo?a=1&b=2` 加换行的字节数(含 5 个汉字 15 字节)。

</details>

### 练习 3:先手算 Content-Length,再让服务器验证

下面两条 POST,body 分别是 `city=北京&days=3` 和用 `--data-urlencode` 发的 `城市=北京`。先**手算**两个 `Content-Length`,再发出去让服务器验证。

<details>
<summary>参考答案</summary>

手算:第一条 `city=北京&days=3`:`city=` 5 个字节,`北京` 两个汉字 6 个字节,`&days=3` 7 个字节,合计 5 + 6 + 7 = **18**。第二条:`--data-urlencode "城市=北京"` 只编码等号后面的值,键 `城市` 原样发出(6 字节),等号 1 字节,值 `北京` 被编成 `%E5%8C%97%E4%BA%AC`(18 个字符),合计 6 + 1 + 18 = **25**。

```bash
curl -s -d "city=北京&days=3" http://127.0.0.1:8765/weather
curl -s --data-urlencode "城市=北京" http://127.0.0.1:8765/weather
```

<div class="line-notes">

- `curl -s -d "city=北京&days=3" http://127.0.0.1:8765/weather` `-d` 发原样的 body,中文不编码,直接按 UTF-8 字节发。
- `curl -s --data-urlencode "城市=北京" http://127.0.0.1:8765/weather` 让 curl 把值编码后再发。

</div>

实测输出:

```text
你发的是 POST /weather,body 有 18 字节
你发的是 POST /weather,body 有 25 字节
```

服务器端对应的头和 body:

```text
Content-Length: 18
'city=北京&days=3'
```

```text
Content-Length: 25
'城市=%E5%8C%97%E4%BA%AC'
```

和手算一致。编码之后 body 变长了(同样是 `北京`,不编码 6 字节,编码后 18 字符),这是百分号编码的代价。

</details>

### 练习 4:同时开两个服务器

保持一个 `echo_server.py` 在终端 1 运行,在另一个终端再启动一次。看报什么错,说明病因和两种解决办法。

<details>
<summary>参考答案</summary>

```bash
uv run python part01/echo_server.py
```

<div class="line-notes">

- `uv run python part01/echo_server.py` 第二次启动同一个文件,它又想监听 `127.0.0.1:8765`,而这个端口已经被第一个占着。

</div>

实测输出(Traceback 只留最后几行,路径缩短):

```text
    socketserver.TCPServer.server_bind(self)
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/socketserver.py", line 478, in server_bind
    self.socket.bind(self.server_address)
OSError: [Errno 48] Address already in use
```

`Address already in use`:这个端口已经有程序在听了,一个端口同一时间只能被一个程序占。解决办法两种:关掉先启动的那个(终端 1 按 `Ctrl+C`,忘了在哪开的话可以用 `lsof -i :8765` 找进程);或者把 `PORT` 改成别的数字,比如 `8766`。前端开发里 `Error: listen EADDRINUSE: address already in use :::3000` 是同一件事。

</details>

### 练习 5:写一个 build_url 函数

写 `part01/build_url.py`,函数 `build_url(base, path, **params)` 拼出带查询串的地址:`base` 末尾和 `path` 开头的斜杠要处理好(不能出现 `//`),`params` 用 `urlencode` 编码,没有参数就不加 `?`。然后用它拼 `http://127.0.0.1:8765/search?q=退款 3 天&limit=10`,检查拼出来的字符串,并把它发给服务器确认。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/build_url.py
from urllib.parse import parse_qs, urlencode, urlsplit


def build_url(base: str, path: str, **params: str | int) -> str:
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    query = urlencode(params)
    return f"{url}?{query}" if query else url


if __name__ == "__main__":
    url = build_url("http://127.0.0.1:8765/", "/search", q="退款 3 天", limit=10)
    print(url)
    print(parse_qs(urlsplit(url).query))
    print(build_url("http://127.0.0.1:8765", "health"))
```

<div class="line-notes">

- `from urllib.parse import parse_qs, urlencode, urlsplit` `urlencode` 是新的:把字典编码成查询串。
- `def build_url(base: str, path: str, **params: str | int) -> str:` `**params` 把所有额外的「名字=值」参数收成一个字典(`**` 收参数的写法在函数那几天会细讲,这里只当成「可以传任意个键值对」);值的类型标成 `str | int`。
- `url = f"{base.rstrip('/')}/{path.lstrip('/')}"` `rstrip('/')` 去掉 `base` 末尾的斜杠,`lstrip('/')` 去掉 `path` 开头的斜杠,中间自己补一个。代入:`base` 是 `http://127.0.0.1:8765/`,`path` 是 `/search`,拼出 `http://127.0.0.1:8765/search`。
- `query = urlencode(params)` 代入 `{"q": "退款 3 天", "limit": 10}`,得到 `q=%E9%80%80%E6%AC%BE+3+%E5%A4%A9&limit=10`,注意空格变成了 `+`,数字 `10` 自动转成字符串。
- `return f"{url}?{query}" if query else url` 查询串非空才加 `?`。第三条调用没有任何参数,`query` 是空字符串,直接返回 `url`。
- `if __name__ == "__main__":` 直接运行这个文件才执行下面的演示。
- `print(parse_qs(urlsplit(url).query))` 把刚拼出来的地址再拆回去,验证来回一致。

</div>

运行:

```bash
uv run python part01/build_url.py
curl -s "http://127.0.0.1:8765/search?q=%E9%80%80%E6%AC%BE+3+%E5%A4%A9&limit=10"
```

实测输出:

```text
http://127.0.0.1:8765/search?q=%E9%80%80%E6%AC%BE+3+%E5%A4%A9&limit=10
{'q': ['退款 3 天'], 'limit': ['10']}
http://127.0.0.1:8765/health
```

服务器收到的请求行是 `GET /search?q=%E9%80%80%E6%AC%BE+3+%E5%A4%A9&limit=10 HTTP/1.1`,和我们拼的一致:`self.path` 原样带着编码。拆回去之后还是 `退款 3 天`,来回无损。`uv run basedpyright part01/build_url.py` 的结果是 0 errors。第 70 天做天气命令行时会用到同样的想法:把城市名这种带中文的参数交给 `urlencode`,而不是自己拼字符串。

</details>

验收标准:`uv run python part01/url_parts.py` 输出和文中一致;服务器能启动,你能用 curl 发出 GET(带查询串)和 POST(带 body)并在服务器终端对上每一行;练习 1 到 5 的输出和参考答案一致;你能不看文章,在纸上画出一次请求由哪几部分组成、说出 GET 和 POST 的三处不同。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| HTTP | 客户端和服务器之间一问一答的文字约定。一次请求,一次响应 |
| 客户端 / 服务器 | 发起请求的一方(浏览器、curl、脚本) / 一直开着、接请求的程序 |
| URL | 统一资源定位符,就是网址,由协议、主机、端口、路径、查询串、片段组成 |
| 协议(scheme) | 网址开头的 `http` 或 `https`,说话方式 |
| 主机(host) | 找哪台机器,域名或 IP |
| 端口(port) | 一台机器上服务的门牌号;`http` 默认 80,`https` 默认 443 |
| 路径(path) | 服务器上要哪个资源 |
| 查询串(query) | `?` 后面的 `键=值&键=值`,给路径补条件 |
| 片段(fragment) | `#` 后面的部分,只给浏览器用,不发给服务器 |
| 百分号编码 | 把不能直接放进网址的字符变成 `%` 加两位十六进制(按 UTF-8 字节) |
| 请求行 | 请求的第一行:方法、路径加查询串、协议版本 |
| 请求头(header) | 请求行之后每行一条的「名字: 值」,描述这次请求 |
| 请求体(body) | 请求头之后空行后面的内容,POST 常用 |
| 方法(method) | `GET`、`POST` 等,表示想做什么 |
| `Host` 头 | 告诉服务器你要的是哪个网站(同一台机器上可能有很多) |
| `User-Agent` | 客户端自报家门的头 |
| `Content-Length` | body 有多少**字节** |
| 127.0.0.1 / localhost | 永远指向你自己这台电脑的地址 |
| curl | 命令行发 HTTP 请求的工具,`-v` 能看到全过程 |

## 常见误区

**以为 GET 绝对不能有 body、POST 绝对不能有查询串。** 都是约定,不是语法限制。POST 的地址里完全可以带 `?`(很多接口就这样),只是习惯上把「条件」放查询串、「要交的内容」放 body。

**把密码放进 GET 的查询串。** 地址会进浏览器历史、服务器日志、代理日志。敏感信息放 body 或请求头。

**curl 的地址不加引号。** 有 `?`、`&` 的地址一定要加引号。不加会报 `no matches found`,或者更糟:参数悄悄丢了,不报错。

**以为 `Content-Length` 是字符数。** 它是字节数,中文一个字 3 字节。自己拼请求的时候(后面讲 FastAPI 和流式输出会碰到)数错了,服务器会少读或者一直等。

**以为 `#` 后面的内容会传给后端。** 不会。需要传给后端的东西不要放在 `#` 后面。

**看到 `Connection refused` 就去查网络。** 先看服务器启动了没、端口号对不对、是不是监听在 `127.0.0.1` 而你连的是另一个地址。

**自己写着玩的服务器监听 `0.0.0.0`。** `0.0.0.0` 的意思是「这台机器的所有网卡」,同一个 Wi-Fi 下别人也能连。调试用的服务器写 `127.0.0.1`。

**以为浏览器发的请求和代码发的有本质区别。** 都是同一种文字,差别只在头里。接口不通的时候,先在浏览器里把请求「Copy as cURL」,在终端里重放,就能分清是网络、服务器还是你的代码出的问题。

## 学习资料

### 文档与文章

- [MDN · HTTP 概述](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Overview):中文,讲客户端、服务器、请求响应这一整套,今天第一节的配套阅读。
- [MDN · HTTP 消息](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Messages):请求和响应的文字结构,有逐行标注的图,对应今天「一次请求长什么样」。
- [MDN · 什么是 URL?](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL):URL 各部分的讲解,图很清楚。
- [MDN · HTTP 请求方法](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods):每个方法的定义和是否安全、幂等,第一遍扫一眼,后面做 API 时会反复回来看。
- [MDN · 百分号编码](https://developer.mozilla.org/zh-CN/docs/Glossary/Percent-encoding):`%E9%80%80` 这类东西的出处。
- [Chrome DevTools · Network 面板参考](https://developer.chrome.com/docs/devtools/network/reference):面板每个区域、Copy as cURL 的位置。
- [Python 文档 · urllib.parse](https://docs.python.org/zh-cn/3/library/urllib.parse.html):今天用的 `urlsplit`、`parse_qs`、`quote`、`urlencode` 都在这一页。
- [Python 文档 · http.server](https://docs.python.org/zh-cn/3/library/http.server.html):官方说这个模块只适合学习和本机调试,不适合真的上线,后面会换 FastAPI。
- [Everything curl](https://everything.curl.dev/):curl 作者写的免费在线书(英文),想系统学 curl 可以按目录读,今天不用。
- [RFC 9110 · HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110):HTTP 的正式规范(英文)。不是让你读完,出现争议时它是最终出处。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RwhJzrECY&autoplay=0&high_quality=1" title="HTTP详解,5分钟学会HTTP请求技术" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>代码奇迹 · HTTP详解,5分钟学会HTTP请求技术 · 约 4 分钟,2025 年。先用最短的视频建立「请求和响应」的画面。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1n94y1U7Eu&autoplay=0&high_quality=1" title="【前后端必学】如何使用cURL命令?有哪些常见的用法?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · 【前后端必学】如何使用cURL命令?有哪些常见的用法? · 约 5 分钟,2022 年。对应今天用到的 -H、-d、-X、-v 这几个选项。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV165411A7ef&autoplay=0&high_quality=1" title="1小时全面入门HTTP协议 - 爬虫,Web开发必备" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>麦叔编程 · 1小时全面入门HTTP协议 · 约 46 分钟,2021 年。讲得全,今天只看前半小时的请求和 URL,响应和状态码留给明后天。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/csMhnJMhCsE" title="How HTTP Works (Request/Response Lifecycle) — Explained for Everybody" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Code In Minutes · How HTTP Works (Request/Response Lifecycle) — Explained for Everybody · 英文,可开字幕。我只核对了标题,没有逐分钟看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2JYT5f2isg4" title="Full HTTP Networking Course – Fetch and REST APIs in JavaScript" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Full HTTP Networking Course – Fetch and REST APIs in JavaScript · 英文,用 JavaScript 讲,前端读者读起来最熟。很长,挑讲请求方法和 URL 的几章看。</figcaption>
</figure>

### 书籍

- 《图解 HTTP》,上野宣 著,于均良 译,人民邮电出版社。日本作者写的入门书,图多、篇幅小,适合第一遍通读。
- 《HTTP 权威指南》(HTTP: The Definitive Guide),David Gourley、Brian Totty 等著,陈涓、赵振平 译,人民邮电出版社。偏厚,当参考书,遇到不清楚的概念再查。

### 开源项目与代码

- [curl/curl](https://github.com/curl/curl):今天一直在用的 curl 本身。读 README 和 `docs/` 就行,不用读 C 源码。
- [python/cpython · Lib/http/server.py](https://github.com/python/cpython/blob/main/Lib/http/server.py):今天用的 `BaseHTTPRequestHandler` 的源码,不到两千行纯 Python,试着找 `do_` 开头的方法是在哪里被调用的(搜 `'do_' + self.command`)。

## 自测

1. `https://shop.example:8443/orders?id=42&sort=new#reviews` 里,协议、主机、端口、路径、查询串、片段分别是什么?哪一段不会发给服务器?

<details><summary>答案</summary>

协议 `https`,主机 `shop.example`,端口 `8443`,路径 `/orders`,查询串 `id=42&sort=new`,片段 `reviews`。片段(`#reviews`)不会发给服务器,只在浏览器里用。

</details>

2. 一次请求的文字由哪几部分组成?空行起什么作用?

<details><summary>答案</summary>

第一行请求行(方法、路径加查询串、协议版本);然后若干行请求头(每行「名字: 值」);然后一个空行,表示头结束;空行后面是可选的 body。GET 通常没有 body,POST 通常有。

</details>

3. GET 和 POST 在请求里有哪三处不同?

<details><summary>答案</summary>

方法名不同(请求行里的 `GET` 与 `POST`);参数放的位置不同(GET 放在地址的查询串里,POST 放在 body 里);POST 带 body 时多出 `Content-Length` 和 `Content-Type` 两个请求头。

</details>

4. `curl -d "name=云簿&plan=team"` 发出去,`Content-Length` 是 21,但这个字符串明明只有 17 个字符。为什么?

<details><summary>答案</summary>

`Content-Length` 数的是字节不是字符。UTF-8 里一个汉字占 3 个字节,「云簿」两个字是 6 字节,比字符数多 4,17 + 4 = 21。

</details>

5. 你运行 `curl http://127.0.0.1:8765/search?q=refund&page=2`,在 macOS 的 zsh 里得到 `zsh: no matches found`。原因是什么?怎么改?如果换成别的 shell 不报错,结果会怎样?

<details><summary>答案</summary>

zsh 把 `?` 当通配符,找不到匹配的文件就报错,curl 根本没运行。改法:给地址加引号。如果 shell 不检查通配符,`&` 会把命令截断成「发 `…search?q=refund`」加「后台执行 `page=2`」,服务器只收到 `q=refund`,`page=2` 悄悄丢失。

</details>

6. (面试题)前端同事说「接口返回的数据不对,但我在 Postman 里是对的、在浏览器里不对」。从今天学的东西出发,你会让他对比请求的哪些部分?

<details><summary>答案</summary>

对比两边发出的完整请求,而不是只看地址:请求行(方法、路径、查询串是否一致,有没有被编码成不同样子,有没有漏掉 `?` 后的参数)、请求头(`Accept`、`User-Agent`、`Cookie`、`Authorization` 等是否一致,服务器可能按这些返回不同内容)、body(POST 时内容和 `Content-Type` 是否一致)。做法是在浏览器 Network 面板里对那个请求用 Copy as cURL,把两边的请求逐行对照。

</details>

## 明天预告

明天是 [Day 60 · HTTP(二):状态码和 header](/blog/agent-zero/day-060-http-2/)。今天只看了请求的一半,而且回的响应一直是服务器自己随手写的 `200`。明天换到响应那一头:`200`、`301`、`401`、`404`、`500` 各代表什么、谁的责任;再多认识几个常用的请求头和响应头,用 curl 亲手制造一次 401 和一次 404。后天(Day 61)才轮到 POST 的 body 和 JSON。
