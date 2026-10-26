---
title: 'Day 62 · 第 9 周复习:编程地基(Day 56–61)'
description: '这周两条线:三天 git(提交、分支与冲突、远程与 PR),三天 HTTP(请求、响应、body)。复习日先画知识地图,默写三段核心代码,再做一个把两条线拧在一起的小项目:一个把工单存进文件、回正确状态码的收件箱服务器加一个命令行客户端,整个过程在分支上开发、制造并解决一次冲突、合并、推到远程。最后是这六天实测过的报错清单。'
pubDate: 2026-10-23
regime: none
tags: ['git', 'http', 'agent-zero']
series: 'agent-zero'
day: 62
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 61](/blog/agent-zero/day-061-http-3/) 把请求的最后一段 body 讲完了:表单和 JSON 两种写法,`Content-Type` 决定服务器用哪把钥匙去读,忘了写它会得到一个莫名其妙的 400。到那一课为止,一次 HTTP 请求和响应的每一段你都亲手拆过了。

往前数三天是 git:Day 56 第一次提交,Day 57 分支、合并、冲突,Day 58 远程、SSH 和 PR。这两条线看起来不相干,其实是以后每天工作的两只手:左手用 git 管代码,右手用 HTTP 和外界说话。今天停一天,把六天的东西摆到一张图上,默写一遍,然后做一个两只手一起用的小项目。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出三段代码:一套「开分支、改出冲突、解决、合并、推到远程」的 git 命令,一个只回 200 和 404 的最小 HTTP 服务器,一个 POST JSON 并把 4xx 当返回值处理的 Python 函数。跑出和文中一致的结果。
2. 只用这六天的知识拼出 `inbox_server.py` 和 `inbox_cli.py`:工单存在 `part01/data/inbox.json` 里,`GET` / `POST` / `DELETE` 各回正确的状态码(200 / 201 / 204 / 400 / 404 / 415),客户端连不上和收到 4xx 时退出码不同;整个过程在分支上做,制造一次冲突并解决,合并到 `main`,推到 `origin`,用 `git ls-remote` 验证。
3. 看到这六天出现过的任何一条报错,不翻文章就能说出病因。

预计用时:3.5 小时。三段默写各 20 分钟,小项目 1.5 小时,剩下的时间做练习和自测。前置:[Day 56](/blog/agent-zero/day-056-git-1/) 到 [Day 61](/blog/agent-zero/day-061-http-3/) 全部。今天不装新依赖,不调 API,花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把三段默写和 `inbox_server.py` 的 `do_POST` 再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

命令都在 `agent-zero-lab` 根目录里跑,新文件放进 `part01/`。Day 58 之后 lab 的分支叫 `main`,远程 `origin` 指向 `~/fake-github/agent-zero-lab.git`(假 GitHub;你如果推到了真的 GitHub,下面所有命令一样)。先确认这两点:

```bash
cd ~/agent-zero-lab
git branch -vv
git status --short
```

我这边 `git branch -vv` 是 `* main d3b72f8 [origin/main] 加 CHANGELOG.md`,`git status --short` 列出 Day 59 到 61 新建的十来个文件,全是 `??`(还没提交过)。这些文件今天会一起处理。输出里的长路径我缩短了,家目录写成 `/Users/你`。

## 本周知识地图

六天分两层。下面一层是 **git**:它管的是「代码随时间怎么变」,三天从一台电脑上的一条线,到多条线,再到多台电脑。上面一层是 **HTTP**:它管的是「两个程序怎么说话」,三天按一次请求的顺序,从地址和方法,到响应的状态码和头,到 body。两层在今天的小项目里交汇:用 HTTP 写一个服务,用 git 把它合进 `main` 推出去。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="本周知识地图:上层 HTTP 三天按请求顺序排列,Day 59 URL、方法、请求行和头,Day 60 状态码和响应头,Day 61 body、JSON 和 Content-Type;下层 git 三天,Day 56 工作区暂存区提交,Day 57 分支合并冲突,Day 58 远程 push pull PR;中间是今天的小项目 inbox,两层在这里交汇">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="24" fill="var(--ink-faint)" font-size="11">HTTP:两个程序怎么说话(按一次请求的顺序)</text>
<rect x="16" y="32" width="190" height="78" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="111" y="54" text-anchor="middle" fill="var(--ink)">Day 59 请求</text>
<text x="111" y="74" text-anchor="middle" fill="var(--ink-soft)" font-size="11">URL 六段 · GET/POST</text>
<text x="111" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="11">请求行 · 请求头 · 空行</text>
<rect x="225" y="32" width="190" height="78" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="54" text-anchor="middle" fill="var(--ink)">Day 60 响应</text>
<text x="320" y="74" text-anchor="middle" fill="var(--ink-soft)" font-size="11">2xx 3xx 4xx 5xx</text>
<text x="320" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Location · Authorization</text>
<rect x="434" y="32" width="190" height="78" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="529" y="54" text-anchor="middle" fill="var(--ink)">Day 61 body</text>
<text x="529" y="74" text-anchor="middle" fill="var(--ink-soft)" font-size="11">表单 / JSON / multipart</text>
<text x="529" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Content-Type 选钥匙</text>
<rect x="130" y="134" width="380" height="60" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="320" y="158" text-anchor="middle" fill="var(--ink)">今天:inbox_server.py + inbox_cli.py</text>
<text x="320" y="180" text-anchor="middle" fill="var(--ink-soft)" font-size="11">在分支上写 → 冲突 → 合并 → push → ls-remote 验证</text>
<line x1="320" y1="110" x2="320" y2="134" stroke="var(--ink-soft)"/>
<line x1="320" y1="194" x2="320" y2="218" stroke="var(--ink-soft)"/>
<text x="16" y="212" fill="var(--ink-faint)" font-size="11">git:代码随时间怎么变(从一条线到多台电脑)</text>
<rect x="16" y="220" width="190" height="78" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="111" y="242" text-anchor="middle" fill="var(--ink)">Day 56 一条线</text>
<text x="111" y="262" text-anchor="middle" fill="var(--ink-soft)" font-size="11">工作区 → 暂存区 → 提交</text>
<text x="111" y="280" text-anchor="middle" fill="var(--ink-soft)" font-size="11">diff · log · .gitignore</text>
<rect x="225" y="220" width="190" height="78" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="242" text-anchor="middle" fill="var(--ink)">Day 57 多条线</text>
<text x="320" y="262" text-anchor="middle" fill="var(--ink-soft)" font-size="11">switch -c · merge</text>
<text x="320" y="280" text-anchor="middle" fill="var(--ink-soft)" font-size="11">冲突标记 · reset · reflog</text>
<rect x="434" y="220" width="190" height="78" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="529" y="242" text-anchor="middle" fill="var(--ink)">Day 58 多台电脑</text>
<text x="529" y="262" text-anchor="middle" fill="var(--ink-soft)" font-size="11">origin · push · pull</text>
<text x="529" y="280" text-anchor="middle" fill="var(--ink-soft)" font-size="11">SSH key · PR · revert</text>
<text x="16" y="320" fill="var(--ink-faint)" font-size="11">蓝色:程序和程序说话;琥珀色:人管代码的历史。小项目两样都用</text>
</g>
</svg>
<figcaption>HTTP 三天是「一次请求从左到右」,git 三天是「一个仓库从小到大」,今天的小项目把两条线接在一起。</figcaption>
</figure>

## 本周每天一句话

- [Day 56](/blog/agent-zero/day-056-git-1/):三个地方,工作区、暂存区、仓库;`git add` 把工作区的样子放进暂存区,`git commit` 把暂存区存成一次提交;`git diff` 看工作区对暂存区、`--cached` 看暂存区对最新提交;提交前三道检查(`.gitignore` 生效没、`add -n` 预演、`diff --cached` 里找 `sk-`),key 进了历史第一件事是作废它。
- [Day 57](/blog/agent-zero/day-057-git-2/):分支只是一张标签,`switch -c` 新建并切过去,切换时工作区的文件会变;`merge` 能快进就快进,两边都有新提交就生成合并提交;两边改了同一行才冲突,标记圈出的只是那几行,改好、`add`、`commit`;`reset` 三档只动本地,推出去的不能用。
- [Day 58](/blog/agent-zero/day-058-git-3/):远程是另一台机器上的另一份仓库,`origin` 是它的别名;`push -u origin main` 之后直接 `push`、`pull`;被拒绝 `rejected (fetch first)` 就先 `pull` 再推;SSH 只交公钥;PR 是「请把我的分支合进 main」;推出去的错误用 `revert` 反向提交。
- [Day 59](/blog/agent-zero/day-059-http-1/):URL 六段,片段不发给服务器;请求是「请求行、请求头、空行、body」四部分的纯文字;GET 把条件放查询串、POST 把内容放 body,带 body 就多 `Content-Length` 和 `Content-Type`;curl 的地址要加引号;`Content-Length` 数字节,中文一个字 3 字节。
- [Day 60](/blog/agent-zero/day-060-http-2/):状态行「版本、状态码、原因短语」;4 开头查自己,5 开头找服务器;301 配 `Location`,401 配 `WWW-Authenticate`,401 换凭证能解决、403 不能;header 名字不分大小写、值分;`urlopen` 把 4xx/5xx 抛成 `HTTPError`;崩溃要在最外层接住翻译成 500。
- [Day 61](/blog/agent-zero/day-061-http-3/):body 的格式由 `Content-Type` 说明,表单 `键=值&键=值` 没有类型,JSON 有类型能嵌套;服务器按头选钥匙,头错了读出空字典回 400,头不认识回 415;`curl --json` 自动补 `Content-Type` 和 `Accept`;Python 里 `json.dumps(...).encode()` 发、`json.loads(resp.read())` 收,`HTTPError` 的 body 也能读。

## 默写一:从开分支到推到远程

一套命令,在一个临时仓库里走完 Day 56 到 58 的主线。合上文章,在 `~/recall-git` 里自己敲一遍,对照下面:

```bash
mkdir ~/recall-git && cd ~/recall-git
git init
printf 'greeting = "你好"\n' > hello.py
git add hello.py
git commit -m "第一版"
git branch -m master main
git switch -c polite
printf 'greeting = "您好"\n' > hello.py
git commit -am "更礼貌"
git switch main
printf 'greeting = "你好,云簿"\n' > hello.py
git commit -am "加公司名"
git merge polite
```

<div class="line-notes">

- `git init` 建仓库。我的 git 是 2.24,新仓库的默认分支叫 `master`。
- `printf 'greeting = "你好"\n' > hello.py` 造一个一行的文件(Day 5 的 `>` 重定向)。
- `git add hello.py` 放进暂存区。
- `git commit -m "第一版"` 第一次提交。
- `git branch -m master main` 改名成 `main`。要在第一次提交**之后**做:没有提交的时候分支还不存在,改名会报 `fatal: invalid reference: main`(我这次就先踩了一下)。
- `git switch -c polite` 开分支并切过去。
- `git commit -am "更礼貌"` 改了已跟踪的文件,`-a` 自动 add 再提交(Day 57)。
- `git switch main` 切回来。工作区里 `hello.py` 会变回「你好」。
- `printf 'greeting = "你好,云簿"\n' > hello.py` 在 `main` 上改**同一行**。
- `git merge polite` 两边都改了同一行,必然冲突。

</div>

实测输出(最后一条命令):

```text
Auto-merging hello.py
CONFLICT (content): Merge conflict in hello.py
Automatic merge failed; fix conflicts and then commit the result.
```

`git status --short` 是 `UU hello.py`(两边都改了),`cat hello.py` 看到标记:

```text
<<<<<<< HEAD
greeting = "你好,云簿"
=======
greeting = "您好"
>>>>>>> polite
```

解决、合并、建远程、推送:

```bash
printf 'greeting = "您好,云簿"\n' > hello.py
git add hello.py
git commit --no-edit
git log --oneline --graph
git init --bare ~/recall-remote.git
git --git-dir=$HOME/recall-remote.git symbolic-ref HEAD refs/heads/main
git remote add origin ~/recall-remote.git
git push -u origin main
git ls-remote origin
git branch -d polite
```

<div class="line-notes">

- `printf 'greeting = "您好,云簿"\n' > hello.py` 把两边的意思合起来写成一行,标记全部去掉。
- `git add hello.py` 冲突时 `add` 的意思是「这个文件我解决了」。
- `git commit --no-edit` 用 git 预填的「Merge branch 'polite' into main」当说明。
- `git log --oneline --graph` 看图。
- `git init --bare ~/recall-remote.git` 一个假远程(Day 58 的做法)。
- `git --git-dir=$HOME/recall-remote.git symbolic-ref HEAD refs/heads/main` 旧版 git 建的裸仓库默认分支是 `master`,把它指到 `main`。真 GitHub 不用这一步。
- `git remote add origin ~/recall-remote.git` 登记远程。
- `git push -u origin main` 推并记住跟踪关系。
- `git ls-remote origin` 问远程有什么,验证。
- `git branch -d polite` 已合并的分支删掉。

</div>

实测输出(`log --graph`、`push`、`ls-remote`、`branch -d` 四段):

```text
*   5b68202 Merge branch 'polite' into main
|\  
| * 60b1ad8 更礼貌
* | 1478e94 加公司名
|/  
* f9cb08a 第一版
```

```text
To /Users/你/recall-remote.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

```text
5b68202f34f456740a0323c41d1a29047df255bb	HEAD
5b68202f34f456740a0323c41d1a29047df255bb	refs/heads/main
```

```text
Deleted branch polite (was 60b1ad8).
```

远程的 `main` 指向 `5b68202`,和本地合并提交的编号一致,推上去了。你的提交编号会不一样,看形状。

## 默写二:只回 200 和 404 的最小服务器

Day 59 到 60 的服务器压缩到二十行。新建 `agent-zero-lab/part01/recall_server.py`:

```python
# agent-zero-lab/part01/recall_server.py
from http.server import BaseHTTPRequestHandler, HTTPServer


class RecallHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/":
            code, text = 200, "首页\n"
        else:
            code, text = 404, f"没有 {self.path}\n"
        data = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8765), RecallHandler).serve_forever()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` 两个零件。
- `class RecallHandler(BaseHTTPRequestHandler):` 继承半成品。
- `def do_GET(self) -> None:` GET 来这里。
- `code, text = 200, "首页\n"` 根路径:状态码和正文一起赋值(Day 22 的多重赋值)。
- `code, text = 404, f"没有 {self.path}\n"` 其他路径。
- `data = text.encode()` 转字节。
- `self.send_response(code)` 状态行。
- `self.send_header("Content-Type", "text/plain; charset=utf-8")` 和 `Content-Length` 两个头,再 `end_headers()` 写空行。
- `self.wfile.write(data)` body。
- `HTTPServer(("127.0.0.1", 8765), RecallHandler).serve_forever()` 只监听本机。

</div>

`uv run python part01/recall_server.py` 之后,另一个终端 `curl -i http://127.0.0.1:8765/` 和 `curl -i http://127.0.0.1:8765/x`,实测输出:

```text
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:44:53 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 7

首页
```

```text
HTTP/1.0 404 Not Found
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:44:53 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 10

没有 /x
```

`Content-Length: 7` 是「首页」6 字节加换行;`10` 是「没有」6 字节、空格、`/x` 两字节、换行。默写时最容易漏的是 `end_headers()` 和 `Content-Length`,漏了前者 curl 会把 body 当成头,漏了后者客户端不知道读到哪里算完。

## 默写三:POST JSON,把 4xx 当返回值

Day 61 的 `post_json` 单独写成一个文件 `agent-zero-lab/part01/recall_post.py`,这次把地址做成参数:

```python
# agent-zero-lab/part01/recall_post.py
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def post_json(url: str, payload: object) -> tuple[int, object]:
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        return e.code, json.loads(e.read())


if __name__ == "__main__":
    print(post_json("http://127.0.0.1:8765/tickets", {"title": "默写", "amount": 1}))
    print(post_json("http://127.0.0.1:8765/tickets", {"amount": 1}))
```

<div class="line-notes">

- `def post_json(url: str, payload: object) -> tuple[int, object]:` 返回「状态码、解析后的 body」。
- `body = json.dumps(payload, ensure_ascii=False).encode()` 对象 → JSON 字符串 → 字节。
- `req = Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})` 三件事一行:body、方法、`Content-Type`。
- `return resp.status, json.loads(resp.read())` 2xx。
- `except HTTPError as e:` 4xx/5xx 不让它炸。
- `return e.code, json.loads(e.read())` 错误 body 同样是 JSON。
- `print(post_json("http://127.0.0.1:8765/tickets", {"title": "默写", "amount": 1}))` 一条好的、一条缺 `title` 的。

</div>

它要发给一个有 `/tickets` 的服务器,下面小项目的 `inbox_server.py` 开着时运行,实测输出:

```text
(201, {'id': 1, 'title': '默写', 'amount': 1})
(400, {'error': 'title 必须是非空字符串'})
```

## 小项目:工单收件箱,存进文件,走一遍 git 流程

Day 61 的 `json_server.py` 把工单存在内存里,关掉就没了。今天把它存进 `part01/data/inbox.json`(Day 39 的 JSON 文件 + Day 37 的 `Path`),加上 `DELETE`,状态码按 Day 60 的表来,再配一个命令行客户端。**整个过程按 Day 57、58 的流程做**:先把这周的作业提交到 `main`,开分支写项目,中途在 `main` 上改一行 README 制造冲突,解决,合并,推。

### 第一步:把 Day 59–61 的作业提交掉

Day 56 的三道检查先过一遍(`.gitignore` 没动过,`.env` 还在被忽略;新文件全是 `.py` 和一个小 JSON):

```bash
git status --short
git add part01/url_parts.py part01/echo_server.py part01/send_urllib.py part01/build_url.py part01/ex59_url.py part01/status_server.py part01/check_status.py part01/json_server.py part01/send_json.py part01/data/ticket.json
git diff --cached --stat
git commit -m "Day 59–61:HTTP 练习(URL、echo/status/json 服务器和客户端)"
git log --oneline -1
```

<div class="line-notes">

- `git status --short` 全是 `??`,十来个文件。
- `git add part01/url_parts.py part01/echo_server.py part01/send_urllib.py part01/build_url.py part01/ex59_url.py part01/status_server.py part01/check_status.py part01/json_server.py part01/send_json.py part01/data/ticket.json` 点名 add,不用 `git add .`(Day 56 的习惯:`.` 会把你没想到的东西带进去)。练习文件你有多少加多少。
- `git diff --cached --stat` 看暂存区里有哪些文件、各改了几行,再确认一眼。
- `git commit -m "Day 59–61:HTTP 练习(URL、echo/status/json 服务器和客户端)"` 一次提交。
- `git log --oneline -1` 看最新一条。

</div>

实测最后一行:`4aad7bb Day 59–61:HTTP 练习(URL、echo/status/json 服务器和客户端)`。

### 第二步:开分支,写服务器

```bash
git switch -c http-inbox
```

输出 `Switched to a new branch 'http-inbox'`。新建 `agent-zero-lab/part01/inbox_server.py`:

```python
# agent-zero-lab/part01/inbox_server.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765
INBOX = Path(__file__).parent / "data" / "inbox.json"


def load() -> list[dict[str, object]]:
    if not INBOX.exists():
        return []
    return json.loads(INBOX.read_text(encoding="utf-8"))


def save(tickets: list[dict[str, object]]) -> None:
    INBOX.parent.mkdir(exist_ok=True)
    INBOX.write_text(json.dumps(tickets, ensure_ascii=False, indent=2), encoding="utf-8")


def ticket_id(path: str) -> int | None:
    head, _, tail = path.rpartition("/")
    if head == "/tickets" and tail.isdigit():
        return int(tail)
    return None


class InboxHandler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_empty(self, code: int) -> None:
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        tickets = load()
        if self.path == "/tickets":
            self._send_json(200, tickets)
            return
        tid = ticket_id(self.path)
        found = [t for t in tickets if t["id"] == tid]
        if found:
            self._send_json(200, found[0])
        else:
            self._send_json(404, {"error": f"没有 {self.path}"})

    def do_POST(self) -> None:
        if self.path != "/tickets":
            self._send_json(404, {"error": f"没有 {self.path}"})
            return
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("application/json"):
            self._send_json(415, {"error": "只收 application/json"})
            return
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"不是合法的 JSON: {e}"})
            return
        if not isinstance(data, dict) or not isinstance(data.get("title"), str) or not data["title"].strip():
            self._send_json(400, {"error": "title 必须是非空字符串"})
            return
        tickets = load()
        next_id = max((int(str(t["id"])) for t in tickets), default=0) + 1
        ticket = {"id": next_id, "title": data["title"].strip(), "amount": data.get("amount", 0)}
        tickets.append(ticket)
        save(tickets)
        self._send_json(201, ticket)

    def do_DELETE(self) -> None:
        tid = ticket_id(self.path)
        tickets = load()
        rest = [t for t in tickets if t["id"] != tid]
        if len(rest) == len(tickets):
            self._send_json(404, {"error": f"没有 {self.path}"})
            return
        save(rest)
        self._send_empty(204)

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},数据在 {INBOX.relative_to(Path.cwd())}", flush=True)
    HTTPServer((HOST, PORT), InboxHandler).serve_forever()
```

<div class="line-notes">

- `from pathlib import Path` Day 37 的路径工具。
- `INBOX = Path(__file__).parent / "data" / "inbox.json"` 数据文件的位置:**相对于这个 `.py` 文件所在目录**,不是相对于你在哪个目录运行。`__file__` 是当前文件的路径,`.parent` 是它所在的 `part01/`。Day 53 练习 3 那个「在子目录跑就读不到」的坑,就是这么躲开的。
- `def load() -> list[dict[str, object]]:` 从文件读全部工单。
- `if not INBOX.exists():` 第一次运行没有文件,当作空列表,不报错。
- `return json.loads(INBOX.read_text(encoding="utf-8"))` 有就读出来解析。
- `def save(tickets: list[dict[str, object]]) -> None:` 整个列表写回文件。
- `INBOX.parent.mkdir(exist_ok=True)` 确保 `part01/data/` 存在,`exist_ok=True` 让已存在时不报错。
- `INBOX.write_text(json.dumps(tickets, ensure_ascii=False, indent=2), encoding="utf-8")` `indent=2` 让文件给人看也舒服(Day 39)。
- `def ticket_id(path: str) -> int | None:` 从 `/tickets/3` 这样的路径里取编号,取不到返回 `None`。
- `head, _, tail = path.rpartition("/")` `rpartition` 从右边找最后一个 `/`,把字符串切成三段:代入 `/tickets/3` 得 `("/tickets", "/", "3")`;代入 `/tickets` 得 `("", "/", "tickets")`。中间那段用 `_` 接住表示不要。
- `if head == "/tickets" and tail.isdigit():` 前面必须正好是 `/tickets`,后面必须全是数字(Day 16 的 `isdigit`)。
- `return int(tail)` 转成整数。
- `class InboxHandler(BaseHTTPRequestHandler):` 处理器。
- `def _send_json(self, code: int, payload: object) -> None:` 和 Day 61 一样。
- `def _send_empty(self, code: int) -> None:` 给 204 用:只有状态行和 `Content-Length: 0`,没有 body(Day 60 练习 1)。
- `def do_GET(self) -> None:` 两种 GET:整个列表,或者单条。
- `tickets = load()` 每次请求都从文件读。效率不高,但今天的目标是正确,不是快。
- `if self.path == "/tickets":` 列表。
- `tid = ticket_id(self.path)` 试着当单条解析。
- `found = [t for t in tickets if t["id"] == tid]` 列表推导(Day 23)找编号相同的。`tid` 是 `None` 时什么都匹配不上,`found` 为空。
- `self._send_json(200, found[0])` 找到了回那一条。
- `self._send_json(404, {"error": f"没有 {self.path}"})` 没找到。`/tickets/99` 和 `/whatever` 都走这里。
- `def do_POST(self) -> None:` 新建工单。
- `if not ctype.startswith("application/json"):` 今天只收 JSON,表单直接 415。比 Day 61 严一点,少一把钥匙代码也少。
- `raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))` 读 body。
- `except json.JSONDecodeError as e:` 坏 JSON → 400。
- `if not isinstance(data, dict) or not isinstance(data.get("title"), str) or not data["title"].strip():` 三个条件任一不满足就 400:不是对象、`title` 不是字符串、`title` 去掉空白后是空的。`data.get("title")` 没有这个键时是 `None`,`isinstance(None, str)` 为假,所以缺字段也被拦下。
- `next_id = max((int(str(t["id"])) for t in tickets), default=0) + 1` 编号用「现有最大号加一」(Day 54 的做法),而不是 Day 61 的「数量加一」:删掉中间一条之后数量会变小,数量加一就可能撞号。`max(..., default=0)` 让空列表时得到 0。`int(str(...))` 是因为类型标注里值是 `object`,检查器不知道它是整数,先转字符串再转整数能让类型对上。
- `ticket = {"id": next_id, "title": data["title"].strip(), "amount": data.get("amount", 0)}` 只收三个字段,客户端多发的字段丢掉,`amount` 没给就是 0。
- `save(tickets)` 写回文件。
- `self._send_json(201, ticket)` 201 带上新条目。
- `def do_DELETE(self) -> None:` 删除。方法名是 `do_DELETE`,`http.server` 会按请求方法找它。
- `rest = [t for t in tickets if t["id"] != tid]` 留下编号不等于它的。
- `if len(rest) == len(tickets):` 一条都没少,说明没有这个编号,404。
- `self._send_empty(204)` 删成功了,没什么可回的,204。
- `print(f"监听 http://{HOST}:{PORT},数据在 {INBOX.relative_to(Path.cwd())}", flush=True)` 启动时把数据文件的相对路径打出来,`relative_to(Path.cwd())` 把绝对路径变成相对当前目录的。

</div>

`uv run basedpyright part01/inbox_server.py` 是 0 errors。数据文件每次运行都会变,不该进仓库,给 `.gitignore` 末尾加两行:

```text
# 运行时生成的工单收件箱
part01/data/inbox.json
```

提交:

```bash
git add .gitignore part01/inbox_server.py
git commit -m "收件箱服务器:文件存储的 /tickets"
```

### 第三步:命令行客户端

新建 `agent-zero-lab/part01/inbox_cli.py`:

```python
# agent-zero-lab/part01/inbox_cli.py
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8765"


def call(method: str, path: str, payload: object = None) -> tuple[int, object]:
    body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    headers = {"Content-Type": "application/json; charset=utf-8"} if body else {}
    req = Request(f"{BASE}{path}", data=body, method=method, headers=headers)
    try:
        with urlopen(req) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except HTTPError as e:
        return e.code, json.loads(e.read())


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("用法: inbox_cli.py list | get 编号 | add 标题 [金额] | rm 编号")
        return 2
    cmd, args = argv[1], argv[2:]
    if cmd == "list":
        code, data = call("GET", "/tickets")
    elif cmd == "get":
        code, data = call("GET", f"/tickets/{args[0]}")
    elif cmd == "add":
        amount = float(args[1]) if len(args) > 1 else 0
        code, data = call("POST", "/tickets", {"title": args[0], "amount": amount})
    elif cmd == "rm":
        code, data = call("DELETE", f"/tickets/{args[0]}")
    else:
        print(f"不认识的命令: {cmd}")
        return 2
    print(code, json.dumps(data, ensure_ascii=False))
    return 0 if code < 400 else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except URLError as e:
        print(f"连不上 {BASE}: {e.reason},服务器开了吗?")
        sys.exit(3)
```

<div class="line-notes">

- `from urllib.error import HTTPError, URLError` 两种错:`HTTPError` 是「连上了但服务器说不行」(4xx/5xx),`URLError` 是「根本没连上」(Day 59 最后那个 `Connection refused` 就是它)。`HTTPError` 是 `URLError` 的子类,所以 `except` 的顺序有讲究,下面会看到。
- `def call(method: str, path: str, payload: object = None) -> tuple[int, object]:` 一个函数管四种请求:方法、路径、可选的 body。
- `body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None` 有 payload 才编码,`GET` 和 `DELETE` 没有 body。
- `headers = {"Content-Type": "application/json; charset=utf-8"} if body else {}` 有 body 才带 `Content-Type`。
- `req = Request(f"{BASE}{path}", data=body, method=method, headers=headers)` `data=None` 时就是没有 body 的请求。
- `raw = resp.read()` 先读字节。
- `return resp.status, json.loads(raw) if raw else None` 204 的 body 是空的,`json.loads(b"")` 会报错,所以空就返回 `None`。
- `except HTTPError as e:` 只接 4xx/5xx,`URLError` 让它往外冒,交给最底下处理。
- `def main(argv: list[str]) -> int:` 返回退出码,不直接 `sys.exit`,这样以后好测试(Day 44 的做法)。
- `if len(argv) < 2:` 没给子命令:打印用法,退出码 2(约定:用法错误用 2)。
- `cmd, args = argv[1], argv[2:]` 第一个词是子命令,其余是参数。
- `code, data = call("GET", "/tickets")` 四个子命令各对应一种请求。
- `amount = float(args[1]) if len(args) > 1 else 0` 金额可选。
- `print(code, json.dumps(data, ensure_ascii=False))` 打印状态码和 body。
- `return 0 if code < 400 else 1` **4xx/5xx 退出码 1**,这样 shell 脚本里能用 `&&` 串联(Day 60 讲 `curl -f` 时说过为什么要这样)。
- `sys.exit(main(sys.argv))` 把 `main` 的返回值变成进程退出码。
- `except URLError as e:` 连不上服务器:给一句人话,退出码 3,和「服务器说不行」区分开。

</div>

`uv run basedpyright part01/inbox_cli.py` 0 errors。先在**没开服务器**的时候跑一下,看那条路通不通:

```bash
uv run python part01/inbox_cli.py list
echo "exit=$?"
```

实测输出:

```text
连不上 http://127.0.0.1:8765: [Errno 61] Connection refused,服务器开了吗?
exit=3
```

提交客户端:

```bash
git add part01/inbox_cli.py
git commit -m "收件箱命令行客户端"
git log --oneline -3
```

```text
2e78dad 收件箱命令行客户端
534cbf2 收件箱服务器:文件存储的 /tickets
4aad7bb Day 59–61:HTTP 练习(URL、echo/status/json 服务器和客户端)
```

### 第四步:跑起来

终端 1 启动服务器:

```bash
uv run python part01/inbox_server.py
```

```text
监听 http://127.0.0.1:8765,数据在 part01/data/inbox.json
```

终端 2 把客户端的每条路都走一遍,每条后面看退出码:

```bash
uv run python part01/inbox_cli.py; echo "exit=$?"
uv run python part01/inbox_cli.py list; echo "exit=$?"
uv run python part01/inbox_cli.py add "退款没到账" 89.5; echo "exit=$?"
uv run python part01/inbox_cli.py add "发票抬头写错"; echo "exit=$?"
uv run python part01/inbox_cli.py add "   "; echo "exit=$?"
uv run python part01/inbox_cli.py get 2; echo "exit=$?"
uv run python part01/inbox_cli.py get 9; echo "exit=$?"
uv run python part01/inbox_cli.py rm 1; echo "exit=$?"
uv run python part01/inbox_cli.py rm 1; echo "exit=$?"
uv run python part01/inbox_cli.py list; echo "exit=$?"
uv run python part01/inbox_cli.py add "第三张" 5; echo "exit=$?"
```

实测输出:

```text
用法: inbox_cli.py list | get 编号 | add 标题 [金额] | rm 编号
exit=2
200 []
exit=0
201 {"id": 1, "title": "退款没到账", "amount": 89.5}
exit=0
201 {"id": 2, "title": "发票抬头写错", "amount": 0}
exit=0
400 {"error": "title 必须是非空字符串"}
exit=1
200 {"id": 2, "title": "发票抬头写错", "amount": 0}
exit=0
404 {"error": "没有 /tickets/9"}
exit=1
204 null
exit=0
404 {"error": "没有 /tickets/1"}
exit=1
200 [{"id": 2, "title": "发票抬头写错", "amount": 0}]
exit=0
201 {"id": 3, "title": "第三张", "amount": 5.0}
exit=0
```

逐条对:没参数是用法提示,退出码 2;空列表 200;两次 add 各 201,编号 1、2;标题全是空格被 400 拦下,退出码 1;`get 2` 200,`get 9` 404;`rm 1` 第一次 204(body 是 `null`,因为 204 没有 body,`call` 返回了 `None`),第二次 404,因为已经没了;列表里只剩 2 号;再 add 一张,编号是 **3** 而不是 2,「最大号加一」起作用了。此时 `part01/data/inbox.json` 的内容:

```json
[
  {
    "id": 2,
    "title": "发票抬头写错",
    "amount": 0
  },
  {
    "id": 3,
    "title": "第三张",
    "amount": 5.0
  }
]
```

关掉服务器再开,`list` 还是这两条,数据真的在文件里。用 curl 再补四种客户端没走到的情况:

```bash
curl -i -X DELETE http://127.0.0.1:8765/tickets/2
curl -i -d "title=x" http://127.0.0.1:8765/tickets
curl -s -o /dev/null -w "%{http_code}\n" --json '{"title": 5}' http://127.0.0.1:8765/tickets
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://127.0.0.1:8765/tickets/3
```

<div class="line-notes">

- `curl -i -X DELETE http://127.0.0.1:8765/tickets/2` 看 204 的完整响应。
- `curl -i -d "title=x" http://127.0.0.1:8765/tickets` 表单格式,今天的服务器不收。
- `curl -s -o /dev/null -w "%{http_code}\n" --json '{"title": 5}' http://127.0.0.1:8765/tickets` `title` 是数字不是字符串。
- `curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://127.0.0.1:8765/tickets/3` 没实现的方法。

</div>

实测输出:

```text
HTTP/1.0 204 No Content
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:21:52 GMT
Content-Length: 0

```

```text
HTTP/1.0 415 Unsupported Media Type
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:21:52 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 36

{"error": "只收 application/json"}
```

```text
400
501
```

204 只有头没有 body;表单 415;`title` 类型错 400;PUT 没写 `do_PUT`,`http.server` 回 501(练习 1 会让它变成有用的东西)。

### 第五步:制造一次冲突,再合并

项目写完了,合并之前先模拟「同事在 `main` 上也动了」:切到 `main`,改 README 里描述 `part01/` 的那一行;再回分支上,改**同一行**。

```bash
git switch main
```

在 `main` 上把 README 里 `- part01/:Python 基础和第一个小项目` 这一行改成 `- part01/:Python 基础、小项目和 HTTP 练习`,提交:

```bash
git commit -am "README:part01 加了 HTTP 练习"
git switch http-inbox
```

在 `http-inbox` 上把同一行改成 `- part01/:Python 基础、小项目和工单收件箱(inbox_server.py + inbox_cli.py)`,提交,再回 `main` 合并:

```bash
git commit -am "README:说明收件箱"
git switch main
git merge --no-ff http-inbox
```

<div class="line-notes">

- `git commit -am "README:说明收件箱"` 分支上的 README 改动。
- `git switch main` 回到要合入的一方。
- `git merge --no-ff http-inbox` `--no-ff` 强制生成合并提交(Day 58 讲 Merge 按钮时说过),这样历史里能看出「这几次提交是一个功能」。

</div>

实测输出:

```text
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.
```

`git status --short`:

```text
M  .gitignore
UU README.md
A  part01/inbox_cli.py
A  part01/inbox_server.py
```

三个文件 git 自己合好了(`M`、`A`),只有 README 是 `UU`。打开它,标记圈出的只有那一行的两个版本:

```text
<<<<<<< HEAD
- part01/:Python 基础、小项目和 HTTP 练习
=======
- part01/:Python 基础、小项目和工单收件箱(inbox_server.py + inbox_cli.py)
>>>>>>> http-inbox
```

把两边的意思合成一行,删掉三行标记:

```text
- part01/:Python 基础、小项目、HTTP 练习和工单收件箱(inbox_server.py + inbox_cli.py)
```

然后:

```bash
git add README.md
git commit --no-edit
git log --oneline --graph -7
git push
git ls-remote origin
git branch -d http-inbox
```

<div class="line-notes">

- `git add README.md` 「解决了」。
- `git commit --no-edit` 完成合并提交。
- `git log --oneline --graph -7` 看最近 7 条的图。
- `git push` Day 58 设过 `-u`,直接推。
- `git ls-remote origin` 验证。
- `git branch -d http-inbox` 合完删分支。

</div>

实测输出(四段):

```text
*   31f4918 Merge branch 'http-inbox' into main
|\  
| * cfcae2a README:说明收件箱
| * 2e78dad 收件箱命令行客户端
| * 534cbf2 收件箱服务器:文件存储的 /tickets
* | 152e43e README:part01 加了 HTTP 练习
|/  
* 4aad7bb Day 59–61:HTTP 练习(URL、echo/status/json 服务器和客户端)
```

```text
To /Users/你/fake-github/agent-zero-lab.git
   d3b72f8..31f4918  main -> main
```

```text
31f49186ee8cb34ff12365407e7c9b68745e7a46	HEAD
31f49186ee8cb34ff12365407e7c9b68745e7a46	refs/heads/main
```

```text
Deleted branch http-inbox (was cfcae2a).
```

图里能看到分支的三次提交挂在一侧,`main` 上的 README 改动在另一侧,合并提交把它们收拢。推送输出 `d3b72f8..31f4918` 说远程的 `main` 从 Day 58 那次提交推进到了合并提交,`ls-remote` 的编号对上。最后再做一次 Day 58 推送前的全历史检查,`git log -p --all | grep -cE "sk-[A-Za-z0-9-]{20,}"` 是 0,`git ls-files | grep env` 只有 `.env.example`。`inbox.json` 没进仓库,因为 `.gitignore` 那两行。

### 零件 → 小项目对照

| 零件 | 哪天 | 在小项目的哪里 |
| --- | --- | --- |
| 点名 `add`、`diff --cached`、提交前查 key | 56 | 第一步、第五步末尾 |
| `switch -c`、`commit -am`、冲突标记、`--no-ff` | 57、58 | 第二步、第五步 |
| `push`、`ls-remote`、`.gitignore` 排除生成文件 | 56、58 | 第二步、第五步 |
| 路径解析(`/tickets/3`) | 59 | `ticket_id` |
| 200 / 201 / 204 / 400 / 404 / 415 / 501 | 60、61 | `do_GET` / `do_POST` / `do_DELETE` |
| `HTTPError` 当返回值、`URLError` 单独处理 | 60 | `inbox_cli.call` 和最底下的 `except` |
| `Content-Type` 检查、`json.loads` 的 400、形状检查 | 61 | `do_POST` |
| `json.dumps(indent=2)` 写文件、`Path(__file__).parent` | 37、39 | `load` / `save` / `INBOX` |
| 「最大号加一」 | 54 | `next_id` |

## 本周错题与坑清单

六天实测过的报错放在一起。左边是你会看到的原文,右边是病因和修法:

| 报错(实测原文) | 哪天 | 病因和修法 |
| --- | --- | --- |
| `fatal: could not resolve HEAD` | 56 | 在还没有任何提交的仓库里 `git restore --staged`。没有提交就没有 HEAD,用 `git rm --cached 文件` 撤回暂存 |
| `git check-ignore` 对某个文件没有输出 | 56 | 它只对**没被跟踪**的文件起作用;已经提交过的文件要先 `git rm --cached`,`.gitignore` 才管得到 |
| `error: The branch 'scratch-idea' is not fully merged.` | 57 | `-d` 删一个有独有提交的分支。git 在保护你,确定不要了用 `-D` |
| `error: Your local changes to the following files would be overwritten by checkout:` | 57 | 带着没提交的改动切分支,而目标分支会改同一个文件。先提交,或者 `git stash`(以后讲),或者放弃改动 |
| `CONFLICT (content): Merge conflict in README.md` | 57、58、62 | 两边改了同一行。打开文件按标记改好,`add`,`commit`;不想处理 `git merge --abort` |
| 提交里还留着 `<<<<<<<` | 57 | 解决冲突时漏删标记。提交前 `grep -n -E '^(<<<<<<<\|=======\|>>>>>>>)' 文件`,退出码 1 才干净 |
| `fatal: No configured push destination.` | 58 | 还没 `git remote add origin 地址` 就 `push` |
| `! [rejected] main -> main (fetch first)` | 58 | 远程有你本地没有的提交。先 `git pull`(可能要解冲突),再 `push` |
| `! [rejected] main -> main (non-fast-forward)` | 58 | 你本地的历史落后于远程(常见于用 `reset` 抹掉了已推出去的提交)。推出去的错误用 `revert`,不要 `reset` 加强推 |
| `Permissions 0644 for '.../id_ed25519_practice' are too open.` | 58 | 私钥文件别人可读,ssh 拒绝使用。`chmod 600 私钥文件` |
| `fatal: invalid reference: main` | 62 | 在第一次提交之前 `git branch -m master main`,那时分支还不存在。先提交再改名 |
| `zsh:1: no matches found: http://127.0.0.1:8765/search?q=refund` | 59 | 地址里有 `?` 没加引号,zsh 当通配符。地址永远加引号 |
| 请求行里 `page=2` 不见了,不报错 | 59 | 地址里的 `&` 没加引号,被 shell 当成「后台运行」截断。同上 |
| `curl: (7) Failed to connect to 127.0.0.1 port 8765` / `URLError: [Errno 61] Connection refused` | 59、62 | 那个端口上没有程序在听:服务器没启动或端口写错 |
| `OSError: [Errno 48] Address already in use` | 59 | 端口被上一个服务器占着。`Ctrl+C` 关掉它,或换端口 |
| `HTTP/1.0 501 Unsupported method ('HEAD')` | 59、61、62 | 服务器没写 `do_HEAD` / `do_PUT` / `do_DELETE`。补上对应方法 |
| `curl: (52) Empty reply from server` | 60 | 服务器处理时抛了没接住的异常,连接被直接关掉。最外层 `try/except` 翻译成 500 |
| `curl: (22) The requested URL returned error: 404` | 60 | 这是 `-f` 的正常行为:4xx/5xx 退出码 22。不加 `-f` 时 404 的退出码是 0,脚本里要注意 |
| `urllib.error.HTTPError: HTTP Error 404: Not Found` | 60 | `urlopen` 把 4xx/5xx 抛成异常。`try/except HTTPError`,从 `e.code`、`e.read()` 取信息 |
| `authorization: bearer xxx` 回 401 | 60 | header 名字不分大小写,**值**分。照文档原样写 `Bearer` |
| `400 {"error": "缺少 title 字段", "received": {}}` 而你明明发了 title | 61 | `-d` 默认按表单发,服务器按表单拆 JSON 文本得到空字典。用 `--json` 或加 `-H "Content-Type: application/json"` |
| `Expecting property name enclosed in double quotes: line 1 column 2 (char 1)` | 61 | JSON 用了单引号或尾逗号。JSON 只认双引号、不许尾逗号 |
| `415 {"error": "不认识的 Content-Type: 'text/plain'"}` | 61、62 | 发了服务器不收的格式。看接口文档要哪种 `Content-Type` |
| `JSON.parse` 报 `"{"amount": Infinity}" is not valid JSON` | 61 | Python 的 `json.dumps` 把无穷大写成 `Infinity`,不是标准 JSON。发给前端前换成 `null` 或用 `allow_nan=False` |
| `json.loads(b"")` 报错 | 62 | 204 的响应没有 body。先判断 `raw` 非空再解析 |

## 动手练习

### 练习 1:给收件箱加 PATCH,在分支上做完并合并

用继承的办法写 `part01/ex62_server.py`:在 `InboxHandler` 上加 `do_PATCH`,`PATCH /tickets/编号` 接收 JSON、更新那一条的字段(不允许改 `id`),回 200 和更新后的工单;编号不存在 404,不是 JSON 415,坏 JSON 400,空对象 400。整个过程开分支 `patch-ticket`、提交、`--no-ff` 合并、推送、删分支。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex62_server.py
import json
from http.server import HTTPServer

from inbox_server import HOST, PORT, InboxHandler, load, save, ticket_id


class PatchHandler(InboxHandler):
    def do_PATCH(self) -> None:
        tid = ticket_id(self.path)
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            self._send_json(415, {"error": "只收 application/json"})
            return
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"不是合法的 JSON: {e}"})
            return
        if not isinstance(data, dict) or not data:
            self._send_json(400, {"error": "body 必须是非空对象"})
            return
        tickets = load()
        for t in tickets:
            if t["id"] == tid:
                t.update({k: v for k, v in data.items() if k != "id"})
                save(tickets)
                self._send_json(200, t)
                return
        self._send_json(404, {"error": f"没有 {self.path}"})


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},多了 PATCH", flush=True)
    HTTPServer((HOST, PORT), PatchHandler).serve_forever()
```

<div class="line-notes">

- `from inbox_server import HOST, PORT, InboxHandler, load, save, ticket_id` 把服务器的零件都借来,`inbox_server.py` 的启动代码在 main guard 下面,导入不会启动它。
- `class PatchHandler(InboxHandler):` 继承,只加一个方法。
- `def do_PATCH(self) -> None:` PATCH 的意思是「只改一部分」(Day 59 的方法表)。
- `tid = ticket_id(self.path)` 复用路径解析。
- `if not self.headers.get("Content-Type", "").startswith("application/json"):` 先查类型,415。
- `except json.JSONDecodeError as e:` 坏 JSON,400。
- `if not isinstance(data, dict) or not data:` 不是对象,或者是空对象 `{}`(空字典为假),400。
- `t.update({k: v for k, v in data.items() if k != "id"})` 字典的 `update` 把另一个字典的键值覆盖进来(Day 24);字典推导把 `id` 过滤掉,客户端发 `"id": 99` 也改不了编号。
- `save(tickets)` 写回。
- `self._send_json(200, t)` 回更新后的那条。
- `self._send_json(404, {"error": f"没有 {self.path}"})` 循环跑完没找到。

</div>

git 部分:

```bash
git switch -c patch-ticket
git add part01/ex62_server.py
git commit -m "收件箱支持 PATCH 改工单"
git switch main
git merge --no-ff patch-ticket -m "Merge branch 'patch-ticket' into main"
git push
git branch -d patch-ticket
```

实测(关键几行):合并输出 `1 file changed, 35 insertions(+)` 和 `create mode 100644 part01/ex62_server.py`,推送输出 `31f4918..13db326  main -> main`,删分支 `Deleted branch patch-ticket (was e4e9d62)`。这次没有冲突,因为 `main` 在分支开出去之后没动过。

验证(启动 `uv run python part01/ex62_server.py`,先 `add` 一张工单):

```bash
uv run python part01/inbox_cli.py add "退款没到账" 89.5
curl -i -X PATCH --json '{"title":"退款没到账(已催)"}' http://127.0.0.1:8765/tickets/1
curl -X PATCH --json '{"id": 99, "amount": 100}' http://127.0.0.1:8765/tickets/1
curl -X PATCH --json '{}' http://127.0.0.1:8765/tickets/1
curl -X PATCH --json '{"title":"x"}' http://127.0.0.1:8765/tickets/7
curl -X PATCH -d "title=x" http://127.0.0.1:8765/tickets/1
uv run python part01/inbox_cli.py get 1
```

实测输出:

```text
201 {"id": 1, "title": "退款没到账", "amount": 89.5}
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:29:39 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 61

{"id": 1, "title": "退款没到账(已催)", "amount": 89.5}
{"id": 1, "title": "退款没到账(已催)", "amount": 100}
{"error": "body 必须是非空对象"}
{"error": "没有 /tickets/7"}
{"error": "只收 application/json"}
200 {"id": 1, "title": "退款没到账(已催)", "amount": 100}
```

第二条改了 `title`;第三条想把 `id` 改成 99,被过滤,只有 `amount` 变了;空对象 400;不存在的编号 404;表单 415;最后用客户端 `get` 确认文件里的确是改过的。

</details>

### 练习 2:推出去的提交错了,用 revert 收回

在 `main` 上给 `CHANGELOG.md` 加一行「收件箱 v2:支持删除所有工单(危险)」并提交、推送;然后假装发现这行不该写,用 Day 58 的 `revert` 收回并再推。看 `git log` 和文件内容,回答:为什么不用 `reset`?

<details>
<summary>参考答案</summary>

```bash
printf -- "- 收件箱 v2:支持删除所有工单(危险)\n" >> CHANGELOG.md
git commit -am "CHANGELOG:写了一条不该写的"
git push
git revert --no-edit HEAD
git log --oneline -4
git push
tail -2 CHANGELOG.md
```

<div class="line-notes">

- `printf -- "- 收件箱 v2:支持删除所有工单(危险)\n" >> CHANGELOG.md` `>>` 是追加(Day 5)。`printf` 后面的 `--` 是告诉它「后面以 `-` 开头的不是选项」,因为这一行正好以 `-` 开头。
- `git commit -am "CHANGELOG:写了一条不该写的"` 提交。
- `git push` 推出去,别人可能已经拉到了。
- `git revert --no-edit HEAD` 生成一次**反向**提交,把 `HEAD` 那次的改动撤掉;`--no-edit` 用默认说明。
- `git push` 把反向提交也推出去。

</div>

实测输出(`revert`、`log`、`push`、`tail` 四段):

```text
[main 4c08a9f] Revert "CHANGELOG:写了一条不该写的"
 Date: Fri Oct 23 16:30:06 2026 +0800
 2 files changed, 1 insertion(+), 1 deletion(-)
```

```text
4c08a9f Revert "CHANGELOG:写了一条不该写的"
0a2395f CHANGELOG:写了一条不该写的
13db326 Merge branch 'patch-ticket' into main
e4e9d62 收件箱支持 PATCH 改工单
```

```text
   0a2395f..4c08a9f  main -> main
```

```text

- 第一个版本:part01 的练习和录入工具
```

历史里两次提交都在(写错的那次和撤销它的那次),文件内容回到了之前。不用 `reset` 的原因是 Day 58 正文演示过的:`reset` 是抹掉历史,远程已经有那次提交、同事也可能拉走了,你抹掉再强推,同事下次一推它又回来了;`revert` 是往前再走一步,所有人的历史都只增不减,自然一致。

(`2 files changed` 是因为我这个仓库的 `CHANGELOG.md` 末尾原来没有换行,`printf` 追加时把上一行也补了换行,git 算成两处;你的可能是 `1 file changed`。)

</details>

### 练习 3:哪次提交把 inbox.json 排除出仓库的?

不翻文章,只用 git 命令找出:是哪一次提交往 `.gitignore` 里加了 `part01/data/inbox.json` 这一行?再确认这个文件现在确实没被跟踪。

<details>
<summary>参考答案</summary>

```bash
git log -S "inbox.json" --oneline
git ls-files | grep inbox
git check-ignore -v part01/data/inbox.json
```

<div class="line-notes">

- `git log -S "inbox.json" --oneline` `-S` 是「找出改动里**增加或删除了**这个字符串的提交」(叫 pickaxe,镐头)。Day 56 讲 `log` 时没讲到,但它是查「这行是谁加的」最快的办法。
- `git ls-files | grep inbox` 被跟踪的文件里带 `inbox` 的。
- `git check-ignore -v part01/data/inbox.json` Day 56 的命令:这个文件被 `.gitignore` 的哪一行命中。

</div>

实测输出:

```text
534cbf2 收件箱服务器:文件存储的 /tickets
```

```text
part01/inbox_cli.py
part01/inbox_server.py
```

```text
.gitignore:21:part01/data/inbox.json	part01/data/inbox.json
```

第一条:只有 `534cbf2` 这次提交的改动里出现了 `inbox.json` 这个字符串,正是加 `.gitignore` 那两行和服务器文件的那次(服务器代码里也有这个字符串)。第二条:被跟踪的只有两个 `.py`,数据文件不在。第三条:`.gitignore` 第 21 行命中(你的行号可能不同)。

</details>

验收标准:三段默写跑出和文中一致的结果;`inbox_server.py` 和 `inbox_cli.py` 的十一条命令输出和文中一致,`part01/data/inbox.json` 内容对得上;`git log --oneline --graph` 里能看到 `http-inbox` 的合并提交,`git ls-remote origin` 的编号和本地 `main` 一致;练习 1 到 3 的输出和参考答案一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `UU` | `git status --short` 里「两边都改了、尚未解决」的冲突标记 |
| `--no-ff` | 合并时强制生成合并提交,不快进,历史里能看出一个功能的边界 |
| `git log -S 字符串` | 找出增删了这个字符串的提交 |
| `git revert` | 用一次反向提交撤销某次提交,历史只增不减 |
| `Path(__file__).parent` | 当前 `.py` 文件所在目录,让数据文件的位置不依赖运行时的目录 |
| `rpartition` | 从右边找分隔符,把字符串切成「前、分隔符、后」三段 |
| `max(..., default=0)` | 空序列时不报错,返回默认值 |
| `URLError` / `HTTPError` | 没连上 / 连上了但 4xx5xx;后者是前者的子类 |
| 退出码 0 / 1 / 2 / 3 | 本项目的约定:成功 / 服务器说不行 / 用法错 / 连不上 |
| `204 No Content` | 成功但没有 body,`DELETE` 之后常用 |
| `PATCH` | 只改资源的一部分 |
| `printf --` | 让 `printf` 把后面以 `-` 开头的内容当文本 |

## 常见误区

**复习日只看不敲。** 默写的意义是暴露「以为会了」的地方:我自己在默写一里就先把 `branch -m` 放到了第一次提交前面,报了 `invalid reference`。合上文章敲一遍,错一次记一辈子。

**小项目直接在 `main` 上写。** 这周学分支就是为了这一刻。开分支、提交、合并、推,把流程走成习惯,以后在真仓库里才不会手抖。

**数据文件的位置相对于「运行时的目录」。** 写成 `Path("part01/data/inbox.json")` 的话,在 `part01/` 里运行就找不到。用 `Path(__file__).parent`。

**编号用「数量加一」。** 删掉中间一条后会撞号。用「最大号加一」。

**客户端把所有失败都当成一种。** 「连不上」和「服务器说不行」是两种病,退出码分开,排查时一眼就知道该看哪边。

**`except URLError` 写在 `except HTTPError` 前面。** `HTTPError` 是 `URLError` 的子类,先接父类会把 4xx 也吞掉,状态码就读不到了。先子类后父类。

**合并前不先 `git status`。** 带着没提交的改动合并,冲突时局面会乱。干净了再合。

**`.gitignore` 里忘了排除运行时生成的文件。** `inbox.json` 一旦提交,每次运行都会让仓库变脏。写服务器时顺手把数据文件加进 `.gitignore`,和代码一起提交。

## 学习资料

### 文档与文章

- [Pro Git 中文版](https://git-scm.com/book/zh/v2):第 2 章「Git 基础」和第 3 章「Git 分支」对应这周三天 git,免费在线,有空就按顺序读。
- [Learn Git Branching(中文)](https://learngitbranching.js.org/?locale=zh_CN):在浏览器里玩分支、合并、远程的闯关游戏,把这周的 git 命令再练一遍。
- [MDN · HTTP 消息](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Messages):请求和响应的结构一页讲完,配合知识地图上层复习。
- [MDN · HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status):小项目用到的 200 / 201 / 204 / 400 / 404 / 415 各一页。
- [MDN · Content-Type](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Content-Type):小项目 415 的依据。
- [Python 文档 · http.server](https://docs.python.org/zh-cn/3/library/http.server.html):`BaseHTTPRequestHandler` 的所有属性和方法,`do_` 方法的命名规则在这。
- [Python 文档 · urllib.error](https://docs.python.org/zh-cn/3/library/urllib.error.html):`URLError` 和 `HTTPError` 的关系。
- [Python 文档 · pathlib](https://docs.python.org/zh-cn/3/library/pathlib.html):`Path.parent`、`mkdir(exist_ok=True)`、`relative_to`。
- [curl 手册页](https://curl.se/docs/manpage.html):`-X`、`--json`、`-w` 的说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ax421U7eZ&autoplay=0&high_quality=1" title="Git处理合并冲突" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>廿一日船 · Git处理合并冲突 · 约 12 分钟,2024 年。从冲突标记到解决再到提交,对应默写一和小项目第五步,看它和你做的有没有不一样的地方。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yKYJ61Ed8&autoplay=0&high_quality=1" title="5 分钟看懂 HTTP 协议｜请求、响应、状态码一次讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟我一起学网络 · 5 分钟看懂 HTTP 协议 · 约 7 分钟,2026 年。请求、响应、状态码一遍过,当作 HTTP 三天的五分钟总复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BA41117Qb&autoplay=0&high_quality=1" title="push冲突与解决方法，git提交冲突的解决方法，冲突产生的原因，git-pull操作" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>迷斯特航 · push冲突与解决方法 · 约 13 分钟,2023 年。专讲 push 被拒绝之后 pull 再解冲突的流程,错题清单里 `rejected (fetch first)` 那一条的视频版。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DloR0BOGNU0" title="Never fear merge conflicts again - git merge/pull tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Philomatics · Never fear merge conflicts again - git merge/pull tutorial · 英文,可开字幕。把 merge 和 pull 里的冲突放在一起讲。我只核对了标题,没有逐分钟看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/iYM2zFP3Zn0" title="HTTP Crash Course & Exploration" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Traversy Media · HTTP Crash Course &amp; Exploration · 英文。方法、状态码、头、body 一小时过一遍,用的是 DevTools 和 Postman,前端读者看着亲切。我只核对了标题。</figcaption>
</figure>

### 书籍

- 《Pro Git》(第 2 版),Scott Chacon、Ben Straub 著,中文版即上面的在线版,也有人民邮电出版社的纸质版《精通 Git》。
- 《图解 HTTP》,上野宣 著,于均良 译,人民邮电出版社。这周 HTTP 三天读完它的前六章,正好。

### 开源项目与代码

- [git/git](https://github.com/git/git):git 本身。不用读源码,看 `Documentation/` 目录里每条命令的说明和 README 的贡献流程,那就是一个真实项目的 PR 规矩。
- [python/cpython · Lib/http/server.py](https://github.com/python/cpython/blob/main/Lib/http/server.py):这周写的所有服务器都站在它上面。搜 `def handle_one_request`,看它怎么用 `'do_' + self.command` 找到你的方法,以及找不到时怎么回 501。

## 自测

1. 一个功能从开分支到出现在远程 `main` 上,要经过哪几条命令?其中哪一步可能出现冲突?

<details><summary>答案</summary>

`git switch -c 分支`、改代码、`git add` / `git commit`(可多次)、`git switch main`、`git merge 分支`(或 `--no-ff`)、`git push`、`git branch -d 分支`。冲突只可能出现在 `merge` 那一步(或者 `push` 被拒绝后的 `pull` 里),而且只在两边改了同一行时。

</details>

2. 写出一次「新建工单」的 HTTP 请求的四部分,以及服务器成功时响应的三部分(状态码、关键响应头、body 大致内容)。

<details><summary>答案</summary>

请求:请求行 `POST /tickets HTTP/1.1`;请求头至少有 `Host`、`Content-Type: application/json`、`Content-Length`;空行;body 是 JSON,如 `{"title": "退款没到账", "amount": 89.5}`。响应:状态行 `201 Created`;响应头 `Content-Type: application/json; charset=utf-8` 和 `Content-Length`;body 是带服务器分配的 `id` 的那条工单。

</details>

3. 客户端遇到「连不上」「404」「204」三种情况,`inbox_cli.py` 分别怎么处理、退出码是多少?

<details><summary>答案</summary>

连不上:`urlopen` 抛 `URLError`,被最外层接住,打印「连不上 …,服务器开了吗?」,退出码 3。404:抛 `HTTPError`,`call` 里接住,返回 `(404, 错误 JSON)`,打印后退出码 1。204:正常返回,body 为空,`call` 返回 `(204, None)`,打印 `204 null`,退出码 0。

</details>

4. 为什么 `inbox_server.py` 用「最大号加一」而不是「数量加一」?删掉 1 号后再新建,两种方法各得到什么编号?

<details><summary>答案</summary>

删掉中间或开头的一条后数量变小,「数量加一」会和现存的编号撞上。例子:有 1、2 两条,删掉 1,剩 1 条;数量加一得 2,和现存的 2 号撞了;最大号加一得 3,不撞。

</details>

5. 推出去的提交发现错了,`reset` 加强推和 `revert` 各会造成什么后果?

<details><summary>答案</summary>

`reset` 抹掉本地历史再 `push --force`,远程的那次提交虽然没了,但拉过它的同事本地还有,他下次推送会把它带回来,大家的历史对不上。`revert` 生成一次反向提交,历史只增不减,所有人 `pull` 之后一致。推出去的一律 `revert`。

</details>

6. (面试题)面试官让你设计一个「工单」接口的状态码:新建成功、新建时 body 不是 JSON、新建时缺标题、查一个不存在的编号、删除成功、用了服务器不支持的方法,各回什么?为什么删除成功不回 200?

<details><summary>答案</summary>

新建成功 201;body 不是 JSON 400(如果连 `Content-Type` 都不对是 415);缺标题 400(或 422,后面学 FastAPI 时会见到它用 422 表示「格式对但内容不合规」);查不存在的编号 404;删除成功 204;不支持的方法 405(`http.server` 偷懒回 501,正经框架回 405 并带 `Allow` 头列出支持的方法)。删除成功回 204 而不是 200,是因为没有内容可回,204 明确告诉客户端「别去解析 body」,客户端代码可以少一个分支。

</details>

## 明天预告

明天是 [Day 63 · REST API:读接口文档,query、path 和鉴权头](/blog/agent-zero/day-063-rest-api/)。这周你自己定了一套接口:`/tickets` 列表、`/tickets/3` 单条、POST 新建、DELETE 删除。这套「资源 + 方法」的约定有个名字叫 REST,业界的 API 几乎都按它来。明天换个角度:不写服务器,去读别人的接口文档,看文档里的 path 参数、query 参数、鉴权头各对应今天学过的哪一段,然后用 curl 把它们一条条调通。
