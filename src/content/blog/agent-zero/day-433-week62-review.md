---
title: 'Day 433 · 第 62 周复习:生产化与安全(Day 427–432)'
description: '这一周从 CI/CD 写到上线检查清单,中间问了三次「这一层要不要自己扛」:模型、运行时、语言。复习日把它们收成一张图,默写部署流水线和对话接口的四道闸门,再写一个只读文件、不花钱的发版前一键检查脚本,第一次跑就抓到 Day 432 说要做却没做的一件事。'
pubDate: 2026-10-23
regime: none
tags: ['ci-cd', 'review', 'checklist', 'production', 'agent-zero']
series: 'agent-zero'
day: 433
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 432](/blog/agent-zero/day-432-prod-project-1/) 把第七部分两个月的零件拼成了一个 200 行的查账服务:配置集中在 `config.py`,身份从登录态注入工具,四道不花钱的检查排在调模型前面,一轮对话用 SSE 事件推出去;然后撞了八道闸门,写了一份上线检查清单,把其中八项变成 `preflight.py`。那一课最后说了一句「在 `ci.yml` 里加一步 `uv run python -m part07.preflight` 就行」。

这一周六天的东西,表面上很散:GitHub Actions、Ollama、托管运行时、Spring AI、Eino、检查清单。其实它们回答的是同一类问题:**代码写完以后,怎么把它安全、便宜、可控地交到用户手里**。今天不学新东西,把这六天收拢,默写两段最容易写错的代码,再做一个只用本周知识的小项目。明天 Day 434 就要把服务部署到公网、做故障演练,今天是上场前最后一次检查装备。

## 今天要解决的问题

复习日的目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,画出「改代码 → CI → 镜像 → 服务器」这条路,以及模型层、运行时层、语言层这三个「自建还是租」的岔路口,说出每个岔路口的判断依据和是哪一天讲的。
2. 默写 `deploy.yml` 的骨架和 `chat()` 的四道闸门,并分别用 actionlint 和 pytest 证明默写对了。
3. 跑通本周小项目 `part07/review62.py`:一个只读文件、不调模型的发版前检查,把 Day 427 的流水线规则、Day 428 的厂商参数坑、Day 432 的预检清单串成一张 14 项的表。
4. 能解释本周三个最容易混的地方:actionlint 通过不等于流水线安全;换了 base URL 不等于换好了厂商;三个 Java/Go 框架的「循环上限」数的不是同一个东西。

预计用时 3–4 小时,大头在默写和练习。前置:[Day 427](/blog/agent-zero/day-427-ci-cd/) 到 [Day 432](/blog/agent-zero/day-432-prod-project-1/) 全部,练习 3 用到 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。这一周的六天,可以按「一次发版」从左到右的顺序摆,再在上面画出三个岔路口:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="本周知识地图:下方是一次发版的路径,git push 之后 CI 跑测试和 preflight,CD 构建镜像并 SSH 部署,最后冒烟;上方是三个自建还是租的岔路口:模型层、运行时层、语言层,分别对应 Day 428、429、430 到 431">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" fill="var(--ink)">三个岔路口:这一层自己扛,还是交给别人</text>
    <rect x="20" y="38" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="115" y="58" text-anchor="middle" fill="var(--ink)">模型层 · 428</text>
    <text x="32" y="78" fill="var(--ink-soft)">API 还是 Ollama/vLLM</text>
    <text x="32" y="96" fill="var(--ink-soft)">打平点:每天 1.5 万次起</text>
    <text x="32" y="110" fill="var(--ink-faint)">理由多半是数据,不是钱</text>
    <rect x="225" y="38" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="58" text-anchor="middle" fill="var(--ink)">运行时层 · 429</text>
    <text x="237" y="78" fill="var(--ink-soft)">自建循环还是托管 harness</text>
    <text x="237" y="96" fill="var(--ink-soft)">运行时费是零头</text>
    <text x="237" y="110" fill="var(--ink-faint)">真代价:锁定、可观测、合规</text>
    <rect x="430" y="38" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="525" y="58" text-anchor="middle" fill="var(--ink)">语言层 · 430–431</text>
    <text x="442" y="78" fill="var(--ink-soft)">内嵌 Java/Go 还是拆服务</text>
    <text x="442" y="96" fill="var(--ink-soft)">看迭代频率和谁值班</text>
    <text x="442" y="110" fill="var(--ink-faint)">上限数法三家都不同</text>
    <text x="20" y="160" fill="var(--ink)">一次发版走的路</text>
    <rect x="20" y="174" width="96" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="68" y="198" text-anchor="middle" fill="var(--ink)">git push</text>
    <text x="68" y="216" text-anchor="middle" fill="var(--ink-faint)">main 分支</text>
    <rect x="136" y="174" width="140" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="206" y="194" text-anchor="middle" fill="var(--ink)">CI · 427</text>
    <text x="206" y="210" text-anchor="middle" fill="var(--ink-soft)">pytest</text>
    <text x="206" y="224" text-anchor="middle" fill="var(--ink-soft)">+ preflight · 432</text>
    <rect x="296" y="174" width="150" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="371" y="194" text-anchor="middle" fill="var(--ink)">CD · 427</text>
    <text x="371" y="210" text-anchor="middle" fill="var(--ink-soft)">needs: test</text>
    <text x="371" y="224" text-anchor="middle" fill="var(--ink-soft)">镜像标签 = 提交哈希</text>
    <rect x="466" y="174" width="154" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="543" y="194" text-anchor="middle" fill="var(--ink)">服务器</text>
    <text x="543" y="210" text-anchor="middle" fill="var(--ink-soft)">compose pull + up</text>
    <text x="543" y="224" text-anchor="middle" fill="var(--ink-soft)">冒烟 smoke.py · 432</text>
    <line x1="116" y1="202" x2="136" y2="202" stroke="var(--ink-soft)"/>
    <line x1="276" y1="202" x2="296" y2="202" stroke="var(--ink-soft)"/>
    <line x1="446" y1="202" x2="466" y2="202" stroke="var(--ink-soft)"/>
    <path d="M 543 230 C 543 280, 371 280, 371 236" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="400" y="292" fill="var(--ink-faint)">冒烟失败 → rollback.yml 按哈希回滚</text>
    <text x="20" y="262" fill="var(--ink-soft)">四道闸门在服务里:</text>
    <text x="20" y="280" fill="var(--ink-soft)">登录 401 → 长度 413</text>
    <text x="20" y="298" fill="var(--ink-soft)">→ 预算 429 → 会话锁 409</text>
    <text x="20" y="316" fill="var(--ink-faint)">都在调模型之前 · 432</text>
  </g>
</svg>
<figcaption>上面三块蓝色是本周三次「自建还是租」的讨论,每一块写了判断时最该看的东西;下面是一次发版的路径,琥珀色是 GitHub 那边的机器替你做的事。虚线是 Day 427 练习里的回滚按钮。</figcaption>
</figure>

我想强调图里的一个对称:**上面三块回答「用什么」,下面一条回答「怎么交付」,两件事互不替代。** 你可以模型全用 API、运行时全自建、语言全用 Python,流水线照样要写;也可以流水线写得很漂亮,却在 `LLM_EXTRA_BODY` 上踩 Day 428 的坑。面试里被问「你的项目怎么上线的」,要能把下面这条线从 push 讲到冒烟;被问「为什么不自己部署模型」,要能拿出上面那三块里的数字。

## 本周每天一句话

[Day 427 · 最小 CI/CD](/blog/agent-zero/day-427-ci-cd/):workflow 文件就是一份按顺序执行的命令清单,用 PyYAML 读出来就是 JSON;`deploy` 用 `needs: test` 等测试变绿才跑,镜像用 `github.sha` 当标签,密钥先放进 `env:` 再给脚本用,回滚是一个手动触发、输入哈希的 workflow。

[Day 428 · 自己跑开源模型](/blog/agent-zero/day-428-local-models/):只改 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 三个环境变量,代码就能改调本机的 Ollama;但厂商专属参数(DeepSeek 的 `thinking`)要跟着换成 Ollama 认的 `reasoning_effort`,否则会被悄悄忽略。按最便宜的卡算,自部署每天要一万五千次请求才打平。

[Day 429 · 托管 Agent 运行时](/blog/agent-zero/day-429-managed-runtimes/):托管运行时接走的是循环、沙箱和会话存储,不是模型;运行时那层的钱通常只是模型费的零头,真正要比的是锁定、可观测、数据合规、调试控制四件事,最后落成一张决策表。

[Day 430 · Java 和 Go(一)](/blog/agent-zero/day-430-java-go-1/):Spring AI 2.0 用 `ChatClient` 加 `@Tool` 写出同一个查账 Agent;它没有按轮数的上限,只有按工具调用次数的 `spring.ai.tools.limits.*`,默认 150。

[Day 431 · Java 和 Go(二)](/blog/agent-zero/day-431-java-go-2/):LangChain4j 用一个接口声明 Agent,不开 `-parameters` 参数名会变成 `arg0`;Eino 的工具返回 error 默认让整次运行失败,要用 `WrapToolWithErrorHandler` 改成交给模型。拆不拆服务,看 Agent 是不是核心、要不要频繁迭代、谁值班。

[Day 432 · 小项目(一)](/blog/agent-zero/day-432-prod-project-1/):把配置、身份注入、超时重试、步数上限、会话锁、预算、审计、健康检查、SSE 拼成一个服务;上线检查清单按「漏了会出什么事」来写,能自动查的八项写成 `preflight.py`,第一次跑就抓到 `20 × 3 = 60` 撞上单轮超时 60 的配置错误。

## 准备环境

今天的代码全部在 Day 432 那个练习目录里。确认三样东西还在:

```bash
cd ~/agent-zero-lab
ls .github/workflows/ part07/service/ part07/preflight.py
uv add pyyaml
LLM_API_KEY=sk-not-used uv run pytest -q
```

<div class="line-notes">

- `cd ~/agent-zero-lab` 练习仓库根目录,下面所有命令都在这里跑。
- `ls .github/workflows/ part07/service/ part07/preflight.py` 应该看到 Day 427 的 `ci.yml`、`deploy.yml`、`rollback.yml`,Day 432 的 `config.py`、`agent.py`、`main.py` 和预检脚本。缺哪个就回那一天补。
- `uv add pyyaml` Day 427 第二步读 workflow 时加过;如果你那天跳过了,这里补上。我装到的是 6.0.3。
- `LLM_API_KEY=sk-not-used uv run pytest -q` 给一个假 key 跑 Day 432 练习 3 的四个闸门测试,证明它们不调模型。

</div>

```text
....                                                                     [100%]
4 passed in 3.97s
```

四个绿点就可以往下走。如果你的仓库还没有 `git init`(Day 427 推到 GitHub 时会建),先 `git init && git branch -M main`,后面的 actionlint 只认 git 仓库里的 workflow,不在仓库里它会报 `no project was found in any parent directories`,这是我今天第一次跑时真的看到的。

## 默写一:部署流水线 `deploy.yml`

合上 Day 427,在一张纸或者一个空文件里写出 `deploy.yml`。不要求一字不差,但下面这几样必须有,它们是 Day 427 每一条「为什么」的落点:

- 只在推到 main 时触发;
- 部署不能并发,而且不取消进行中的部署;
- 两个 job,`deploy` 要等 `test`;
- `deploy` 的权限只有读代码和写镜像仓库;
- 镜像标签是提交哈希;
- SSH 的私钥和主机名从 Secrets 来,先放进 `env:`,脚本里用 `$SSH_KEY` 读。

写完先别对答案,用两样工具检查。第一样是 Day 427 用过的 actionlint,第二样是今天的小项目里会写的规则检查(写完小项目再回来跑):

```bash
actionlint
uv run python -m part07.review62
```

<div class="line-notes">

- `actionlint` 在仓库根目录直接跑,它会找 `.github/workflows/` 下所有文件。没有输出、退出码 0 就是通过。它查的是语法、缩进、表达式里引用的东西存不存在。
- `uv run python -m part07.review62` 今天小项目的脚本,它查的是 actionlint 不管的「规则」:有没有 `needs: test`、标签是不是哈希、密钥是不是直接拼进了命令。练习 1 会让你看到这两者的差别。

</div>

<details><summary>参考答案</summary>

```yaml
# agent-zero-lab/.github/workflows/deploy.yml(默写版,和 Day 427 等价)
name: test-and-deploy
on:
  push:
    branches: [main]
concurrency:
  group: deploy-production
  cancel-in-progress: false
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - run: uv sync --locked
      - run: uv run pytest -q
  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          HOST: ${{ secrets.DEPLOY_HOST }}
          TAG: ${{ github.sha }}
        run: |
          install -m 600 /dev/null key
          echo "$SSH_KEY" > key
          ssh -i key -o StrictHostKeyChecking=accept-new deploy@"$HOST" \
            "cd agent-zero-lab && git pull --ff-only && IMAGE_TAG=$TAG docker compose pull api && IMAGE_TAG=$TAG docker compose up -d api"
```

<div class="line-notes">

- `branches: [main]` 只有推 main 才部署。Day 427 的坑:本地分支叫 master 的话,推上去什么都不会发生,也不报错。
- `cancel-in-progress: false` 连推两次,第二次排队;部署做到一半被取消,服务器会停在半新半旧的状态。
- `needs: test` 整个文件最重要的一行。删掉它,测试红了照样上线。
- `packages: write` 往 GHCR 推镜像只要这一项写权限;`contents: read` 只读代码。
- `password: ${{ secrets.GITHUB_TOKEN }}` 每次运行自动发的临时 token,权限由上面的 `permissions` 决定。这里直接写 `${{ }}` 是可以的,因为它在 `with:` 里交给 action,不是拼进 shell 命令。
- `tags: ghcr.io/${{ github.repository }}:${{ github.sha }}` 提交哈希当标签,回滚时才说得清回到哪一版。
- `SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}` 密钥先进环境变量,下面脚本用 `$SSH_KEY`,不在命令文本里做替换。
- `install -m 600 /dev/null key` 先建一个只有自己能读写的空文件,再写私钥进去,ssh 才肯用它。
- `"cd agent-zero-lab && git pull --ff-only` 引号里整串在服务器上执行:更新代码、拉这个哈希的镜像、只重建 api 容器。

</div>

我对着这份答案默写了一遍,actionlint 0 报错,今天的 `review62` 里五项 Day 427 规则全过。默写时我自己漏的是 `concurrency` 那三行,这也是 Day 427 里讲得最快的一处,你漏了不奇怪,但要知道它防的是什么。

</details>

## 默写二:`chat()` 的四道闸门

第二段默写 Day 432 `main.py` 里的 `chat()`。只写闸门部分,`stream()` 里面可以写一句 `...` 代替。要点有三个:顺序(便宜的在前)、每道的状态码、为什么它们都在 `stream()` 外面。

验证方法是 Day 432 练习 3 的测试。把你默写的版本替换进 `main.py`,跑:

```bash
LLM_API_KEY=sk-not-used uv run pytest -q tests/test_service_guards.py
```

<div class="line-notes">

- `LLM_API_KEY=sk-not-used` 假 key。四道闸门都不该碰模型,真碰到了会报 401,测试就会红。后面的 `tests/test_service_guards.py` 是 Day 432 写的四个测试:401、413、429、健康检查。会话锁 409 不在里面,练习 3 补。

</div>

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/service/main.py 里的 chat()(默写版,stream 里面省略)
@app.post("/api/chat")
async def chat(body: ChatIn, x_demo_customer: str = Header()) -> StreamingResponse:
    if x_demo_customer not in DEMO_CUSTOMERS:
        raise HTTPException(401, "未登录")
    if len(body.text) > settings.max_message_chars:
        raise HTTPException(413, f"消息太长,最多 {settings.max_message_chars} 字")
    today = date.today().isoformat()
    if spent[today] >= settings.daily_budget_yuan:
        raise HTTPException(429, "今天的演示额度已用完")
    lock = locks[x_demo_customer]
    if lock.locked():
        raise HTTPException(409, "上一条消息还在处理")
    ...
```

<div class="line-notes">

- `async def chat(body: ChatIn, x_demo_customer: str = Header()) -> StreamingResponse:` `Header()` 让 FastAPI 从请求头 `X-Demo-Customer` 取值,下划线自动对应连字符。
- `raise HTTPException(401, "未登录")` 第一道,登录。最便宜,也最该先挡:不认识的人后面什么都不用看。
- `raise HTTPException(413,` 第二道,长度。500 字以上既贵,又是注入攻击常用的载体。
- `today = date.today().isoformat()` 预算按日期记账,键是 `"2026-10-23"` 这样的字符串。
- `raise HTTPException(429, "今天的演示额度已用完")` 第三道,预算。
- `if lock.locked():` 第四道,会话锁。只看锁有没有被占,不在这里拿锁;拿锁在 `stream()` 里的 `async with lock:`,这样流结束(包括客户端断开)时一定会释放。
- `...` 后面就是 Day 432 的 `stream()` 和 `return StreamingResponse(...)`。四道闸门都写在它前面,所以没通过时返回的是正常的 4xx,不是一个已经发出 200 的流。

</div>

替换回去跑测试,输出:

```text
....                                                                     [100%]
4 passed in 2.81s
```

最常见的默写错误是把预算检查写成 `>`:`spent[today] > settings.daily_budget_yuan`。预算正好用到 1.0 元时还会放一个请求进去,多花一轮。测试 `test_budget_used_up_is_429` 把花费设成**正好等于**预算,所以能抓到这个错。

</details>

## 本周小项目:发版前一键检查

### 为什么要这个脚本

Day 432 的 `preflight.py` 查的是服务本身:超时、身份字段、Dockerfile。但这一周还有两类东西没人查。

一类是流水线文件。actionlint 只管写得对不对,不管写得好不好:你把 `needs: test` 删了,它照样 0 报错,因为「deploy 不等 test」在语法上完全合法。另一类是 `.env` 里的厂商配置:Day 428 那个坑,把 `LLM_BASE_URL` 换成 Ollama,`LLM_EXTRA_BODY` 还是 DeepSeek 的 `thinking`,程序不报错,只是思考关不掉,回答变空。

今天写一个 `part07/review62.py`,把这两类规则和 Day 432 的八项预检拼在一起。约束只有一条,和 Day 432 一样:**只读文件,不调模型,一分钱不花**,这样它可以在每次发版前随手跑。

### 代码

```python
# agent-zero-lab/part07/review62.py
"""第 62 周复习小项目:发版前一键检查。只读文件、不调模型、不花钱。
用法:在 agent-zero-lab 目录里 uv run python -m part07.review62"""
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from part07.preflight import CHECKS as PREFLIGHT

WF = Path(".github/workflows")


def load(name: str) -> dict[Any, Any]:
    return yaml.safe_load((WF / name).read_text(encoding="utf-8"))


def all_runs(wf: dict[Any, Any]) -> list[str]:
    return [s.get("run", "") for job in wf["jobs"].values() for s in job["steps"]]


def ci_runs_preflight() -> str | None:
    runs = all_runs(load("ci.yml"))
    if not any("pytest" in r for r in runs):
        return "ci.yml 里没有跑 pytest"
    if not any("part07.preflight" in r for r in runs):
        return "ci.yml 里没有跑 preflight,清单检查只在你本机跑过"
    return None


def deploy_needs_test() -> str | None:
    deploy = load("deploy.yml")["jobs"]["deploy"]
    needs = deploy.get("needs")
    needs = [needs] if isinstance(needs, str) else (needs or [])
    return None if "test" in needs else "deploy 没有 needs: test,测试红了照样上线"


def image_tag_is_sha() -> str | None:
    for step in load("deploy.yml")["jobs"]["deploy"]["steps"]:
        if "build-push-action" in step.get("uses", ""):
            tags = str(step.get("with", {}).get("tags", ""))
            if "github.sha" not in tags or ":latest" in tags:
                return f"镜像标签是 {tags!r},出事时说不清线上是哪一版"
            return None
    return "deploy 里找不到 build-push-action"


def secrets_not_inline() -> str | None:
    for name in ("deploy.yml", "rollback.yml"):
        for run in all_runs(load(name)):
            if "${{ secrets." in run:
                return f"{name} 的 run 里直接拼了 secrets,要先放进 env:"
    return None


def permissions_declared() -> str | None:
    perms = load("deploy.yml")["jobs"]["deploy"].get("permissions")
    if not perms:
        return "deploy 没写 permissions,GITHUB_TOKEN 用的是默认权限"
    extra = {k: v for k, v in perms.items() if v == "write" and k != "packages"}
    return f"deploy 多给了写权限 {extra}" if extra else None


def vendor_params_match() -> str | None:
    base = os.environ["LLM_BASE_URL"]
    extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
    if "deepseek" in base and "thinking" not in extra:
        return "调 DeepSeek 却没关思考,max_tokens 可能被思考吃光"
    if "deepseek" not in base and "thinking" in extra:
        return f"thinking 是 DeepSeek 的写法,{base} 不认识,会被悄悄忽略"
    return None


GATES: list[tuple[str, str, Callable[[], str | None]]] = [
    ("427", "CI 跑测试和清单", ci_runs_preflight),
    ("427", "部署等测试通过", deploy_needs_test),
    ("427", "镜像标签用提交哈希", image_tag_is_sha),
    ("427", "密钥经 env 传给脚本", secrets_not_inline),
    ("427", "部署 job 最小权限", permissions_declared),
    ("428", "厂商专属参数跟着厂商换", vendor_params_match),
] + [("432", name, check) for name, check in PREFLIGHT]

if __name__ == "__main__":
    failed = 0
    for day, name, check in GATES:
        problem = check()
        failed += problem is not None
        mark = "FAIL" if problem else " OK "
        print(f"[{mark}] Day {day} {name}" + (f":{problem}" if problem else ""))
    print(f"\n{len(GATES) - failed}/{len(GATES)} 通过")
    raise SystemExit(1 if failed else 0)
```

<div class="line-notes">

- `import yaml` PyYAML,Day 427 第二步用它把 workflow 读成 Python 的 dict,和你在前端 `JSON.parse` 一个配置文件是一回事。
- `from part07.preflight import CHECKS as PREFLIGHT` 直接复用 Day 432 那张检查表,不抄一份。`as` 起个别名,读起来知道它是 preflight 的。副作用和 Day 432 一样:import 时会读 `.env`、建模型客户端(只是建,不调用),所以要用 `-m` 在仓库根目录跑。
- `WF = Path(".github/workflows")` 相对路径,所以必须在仓库根目录运行。
- `def load(name: str) -> dict[Any, Any]:` 键的类型写 `Any` 而不是 `str`,因为 Day 427 发现 YAML 会把 `on:` 读成布尔值 `True`,顶层的键不全是字符串。
- `return [s.get("run", "") for job in wf["jobs"].values() for s in job["steps"]]` 两层推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)):把所有 job 的所有 step 的 `run` 命令拉平成一个列表。`uses` 型的步骤没有 `run`,`.get` 给空字符串。对 `ci.yml` 实跑得到 `['', '', 'uv sync --locked', 'uv run pytest -q']`。
- `if not any("part07.preflight" in r for r in runs):` Day 432 说要把预检接进 CI,这里检查它真的接了。`any(...)` 相当于 JS 的 `runs.some(r => r.includes(...))`。
- `needs = [needs] if isinstance(needs, str) else (needs or [])` `needs` 在 YAML 里可以写成一个字符串 `needs: test`,也可以写成列表 `needs: [test, lint]`。先统一成列表再判断,两种写法都认。
- `if "build-push-action" in step.get("uses", ""):` 找到构建推送那一步。`uses` 后面带着版本号 `@v7`,所以用 `in` 而不是 `==`。
- `if "github.sha" not in tags or ":latest" in tags:` 标签里要有提交哈希,而且不能有 latest。注意 `tags` 读出来的是原样的字符串 `ghcr.io/${{ github.repository }}:${{ github.sha }}`,`${{ }}` 是 GitHub 运行时才替换的,PyYAML 不认识它,就当普通文字。
- `if "${{ secrets." in run:` 在 shell 命令文本里直接出现 secrets 表达式,就是 Day 427 说的「拼进命令」。在 `env:` 或 `with:` 里出现不算,所以只查 `run`。
- `extra = {k: v for k, v in perms.items() if v == "write" and k != "packages"}` 字典推导式:挑出除了 packages 之外的所有写权限。Day 427 的 deploy 只该写镜像仓库。
- `base = os.environ["LLM_BASE_URL"]` 不需要自己 `load_dotenv()`,上面 import preflight 时已经顺带读过 `.env` 了。
- `if "deepseek" not in base and "thinking" in extra:` Day 428 的坑原样写成规则:地址不是 DeepSeek,参数却是 DeepSeek 的方言。规则很粗,只认识我们用过的两家;你换了别的厂商,在这里加一条。
- `GATES: list[tuple[str, str, Callable[[], str | None]]] = [` 每项三个字段:哪一天学的、检查名、检查函数。函数的约定和 Day 432 一样,没问题返回 `None`,有问题返回一句说明。
- `] + [("432", name, check) for name, check in PREFLIGHT]` 把 Day 432 的八项拼在后面,统一标成 432。
- `failed += problem is not None` 布尔值当 1 和 0 加,Day 432 见过。
- `raise SystemExit(1 if failed else 0)` 有失败就以 1 退出,放进任何自动化流程都能判红绿。

</div>

### 第一次跑:抓到一件「说了要做」的事

```bash
cd ~/agent-zero-lab
uv run python -m part07.review62
```

我第一次跑的真实输出:

```text
[FAIL] Day 427 CI 跑测试和清单:ci.yml 里没有跑 preflight,清单检查只在你本机跑过
[ OK ] Day 427 部署等测试通过
[ OK ] Day 427 镜像标签用提交哈希
[ OK ] Day 427 密钥经 env 传给脚本
[ OK ] Day 427 部署 job 最小权限
[ OK ] Day 428 厂商专属参数跟着厂商换
[ OK ] Day 432 .env 不进 git
[ OK ] Day 432 仓库里没有明文 key
[ OK ] Day 432 容器不用 root 跑
[ OK ] Day 432 超时内层短于外层
[ OK ] Day 432 步数、长度、预算都有上限
[ OK ] Day 432 身份不从工具参数来
[ OK ] Day 432 配置打印不泄露 key
[ OK ] Day 432 健康检查不调模型

13/14 通过
```

第一项是真的漏了。Day 432 的最后一段写着「在 `ci.yml` 里加一步就行」,我读到了,也觉得很简单,然后就去写下一节了。`preflight.py` 一直只在我本机跑过,CI 里从来没跑。这和 Day 432 抓到的超时配置是同一种错:懂,但没做。

补上。把 `ci.yml` 改成下面这样:

```yaml
# agent-zero-lab/.github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - run: uv sync --locked
      - run: uv run pytest -q
        env:
          LLM_BASE_URL: https://api.deepseek.com
          LLM_API_KEY: ci-dummy
          LLM_MODEL: deepseek-flash
      - run: uv run python -m part07.preflight
        env:
          LLM_BASE_URL: https://api.deepseek.com
          LLM_API_KEY: ci-dummy
          LLM_MODEL: deepseek-flash
```

<div class="line-notes">

- `- run: uv run pytest -q` 原来就有。下面多了三行 `env:`,因为 Day 432 加了 `tests/test_service_guards.py`,它会 import `main.py`,`Settings()` 要求这三个变量必须存在。CI 里没有 `.env`,不给就是 `KeyError: 'LLM_BASE_URL'`,我在本机把 `.env` 挪开模拟了一次,报的就是这个。
- `LLM_API_KEY: ci-dummy` 随便一个值。闸门测试和预检都不调模型,真 key 不需要,也不应该给。
- `- run: uv run python -m part07.preflight` 新加的一步,在测试之后。预检有一项失败,退出码 1,这一步变红,PR 合不进去。

</div>

再跑 actionlint 和 review62:

```text
$ actionlint
$ uv run python -m part07.review62 | tail -1
14/14 通过
```

### 顺手发现:改名的 `.env` 也会被扫出来

为了确认 CI 那边没有 `.env` 也能跑,我把本机的 `.env` 临时改名成 `.env.hold`,再带着三个假变量跑 review62,结果多了两项失败:

```text
[FAIL] Day 428 厂商专属参数跟着厂商换:调 DeepSeek 却没关思考,max_tokens 可能被思考吃光
[FAIL] Day 432 仓库里没有明文 key:.env.hold 里有像 API key 的字符串
```

第一项是对的:没有 `.env` 就没有 `LLM_EXTRA_BODY`,这条规则本来就是给本机发版前用的,CI 里只跑 preflight。第二项更有意思,它说明 Day 432 的扫描只跳过名字**正好**是 `.env` 的文件,而 `.gitignore` 也只忽略 `.env`。你把它改名成 `.env.hold`、`.env.bak`、`.env.local`,`git add .` 就会把真 key 提交上去,扫描能抓到这一点是对的。改回 `.env` 后又是 14/14。我的建议是 `.gitignore` 里写 `.env*` 再加一行 `!.env.example`,把所有变体都挡住,只放行示例文件。

### 零件和大代码的对照

| 零件 | 在 review62 的哪 | 学它的那天 |
| --- | --- | --- |
| workflow 就是一份 JSON | `load()` 用 `yaml.safe_load` | Day 427 第二步 |
| `on:` 被读成 `True` | `dict[Any, Any]` 的类型标注 | Day 427 第二步 |
| `needs` 决定 job 顺序 | `deploy_needs_test()` | Day 427 第五步、练习 4 |
| 镜像标签用提交哈希 | `image_tag_is_sha()` | Day 427 第五步 |
| secrets 经 `env:` 传 | `secrets_not_inline()` | Day 427 第五步 |
| 最小权限的 `permissions` | `permissions_declared()` | Day 427、Day 413 |
| 厂商专属参数 | `vendor_params_match()` | Day 428 第三步 |
| 上线检查清单的自动部分 | `PREFLIGHT` 八项 | Day 432 第六步 |
| 预检接进 CI | `ci_runs_preflight()` 和改过的 `ci.yml` | Day 432 第六步结尾 |

## 本周错题与坑清单

这些都是这一周六天里真实出现过的报错或现象,按我觉得最容易再犯的顺序排:

1. **本地分支叫 master,workflow 写 main。** Actions 页面一片空白,没有任何报错(Day 427)。
2. **手写 `pyproject.toml` 依赖不更新 lock。** CI 报 `The lockfile at uv.lock needs to be updated, but --locked was provided.`(Day 427)。
3. **actionlint 0 报错就以为流水线没问题。** 删掉 `needs: test` 它照样通过,规则要自己查(今天练习 1)。
4. **YAML 把 `on:` 读成 `True`。** 写脚本读 workflow 时 `wf["on"]` 会 `KeyError`(Day 427)。
5. **换了 base URL,没换 `LLM_EXTRA_BODY`。** Ollama 悄悄忽略 DeepSeek 的 `thinking`,思考模式把 200 个 token 吃光,回答是空字符串,`finish_reason` 是 `length`(Day 428)。
6. **以为 0.6B 模型只占 639MB。** 默认 40960 的上下文窗口跑起来占了 5.6GB(Day 428)。
7. **只比运行时的钱。** 托管运行时一个月几美元,真正的差别在模型被锁定:同样工单 Sonnet 和 DeepSeek 差了好几倍(Day 429)。
8. **用 `source .env` 给 Java 程序导变量。** `.env` 里的 JSON 让 zsh 报 `parse error near '{'`(Day 430)。
9. **在 Spring AI 里找 max_steps。** 只有按工具调用次数的上限,默认 150(Day 430)。
10. **纯 Maven 项目没开 `-parameters`。** 参数名变成 `arg0`,不报错,模型调工具的准确率悄悄变差(Day 431)。
11. **Go 工具用 error 表示「查不到」。** Eino 默认整次运行失败,报 `[NodeRunError] failed to invoke tool`(Day 431)。
12. **`llm_timeout × (重试 + 1)` 等于单轮超时。** 20 × 3 = 60,外层先超时,日志里还在重试(Day 432)。
13. **Day 432 说了要接进 CI 的预检,一直只在本机跑。** 今天 review62 第一项抓到的。
14. **改了名的 `.env.hold` 会被提交。** `.gitignore` 只写了 `.env`(今天顺手发现的)。

## 动手练习

### 练习 1:删掉 `needs: test`,actionlint 和 review62 谁能抓到

先猜,再跑。把 `deploy.yml` 里 `needs: test` 那一行删掉,分别跑 `actionlint` 和 `review62`。跑完把那一行恢复。

<details><summary>参考答案</summary>

```bash
cp .github/workflows/deploy.yml dep.bak
sed -i '' '/^    needs: test$/d' .github/workflows/deploy.yml
actionlint; echo "actionlint 退出码 $?"
uv run python -m part07.review62 | grep -E "FAIL|^[0-9]+/"
cp dep.bak .github/workflows/deploy.yml && rm dep.bak
```

<div class="line-notes">

- `cp .github/workflows/deploy.yml dep.bak` 先备份,改坏了能一步还原。
- `sed -i '' '/^    needs: test$/d' .github/workflows/deploy.yml` 删掉正好是「四个空格 + needs: test」的那一行。`/模式/d` 是 sed 的「匹配到就删除」,macOS 的 `-i` 后面要跟 `''`。
- `actionlint; echo "actionlint 退出码 $?"` `$?` 是上一条命令的退出码。
- `grep -E "FAIL|^[0-9]+/"` 只看失败的项和最后的通过数。
- `cp dep.bak .github/workflows/deploy.yml && rm dep.bak` 还原。

</div>

实跑:

```text
actionlint 退出码 0
[FAIL] Day 427 部署等测试通过:deploy 没有 needs: test,测试红了照样上线
13/14 通过
```

actionlint 一声不吭,退出码 0。没有 `needs` 的两个 job 在 GitHub 上会**同时开始**,测试还在跑,镜像已经在构建、SSH 已经在部署了,这在语法上完全合法。actionlint 是语法和类型检查,相当于前端的 TypeScript 编译器;「部署必须等测试」是团队规则,相当于 ESLint 里你自己加的一条自定义规则,得自己写。

</details>

### 练习 2:切到 Ollama 却忘了换参数,review62 能不能拦住

Day 428 的切换方法是在命令前面临时给环境变量。请模拟「只换了地址和模型名,没换 `LLM_EXTRA_BODY`」和「全换对了」两种情况,各跑一次 review62。不需要真的开着 Ollama,脚本不会连它。

<details><summary>参考答案</summary>

```bash
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=modelscope.cn/Qwen/Qwen3-0.6B-GGUF \
  uv run python -m part07.review62 | grep -E "FAIL|^[0-9]+/"
LLM_BASE_URL=http://localhost:11434/v1 LLM_EXTRA_BODY='{"reasoning_effort":"none"}' \
  uv run python -m part07.review62 | grep -E "FAIL|^[0-9]+/"
```

<div class="line-notes">

- `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=modelscope.cn/Qwen/Qwen3-0.6B-GGUF \` 命令前写 `变量=值`,只对这一条命令生效;`load_dotenv()` 不覆盖已有变量,所以它们比 `.env` 优先。`LLM_EXTRA_BODY` 没给,于是用的是 `.env` 里 DeepSeek 的那一份。行尾 `\` 是续行。
- `LLM_EXTRA_BODY='{"reasoning_effort":"none"}'` 第二次连参数也换成 Ollama 认的写法。JSON 外面用单引号包住,shell 才不会去解释里面的双引号。

</div>

```text
[FAIL] Day 428 厂商专属参数跟着厂商换:thinking 是 DeepSeek 的写法,http://localhost:11434/v1 不认识,会被悄悄忽略
13/14 通过
14/14 通过
```

第一次被拦住,第二次通过。这类检查的价值在于它把「我记得 Day 428 有个坑」变成了「脚本记得」。我自己的建议仍然是 Day 428 那一条:每个厂商一份完整的配置文件,切换时整份换,而不是零散地 export。

</details>

### 练习 3:给会话锁 409 和单轮超时补上不花钱的测试

Day 432 练习 3 留了一个加练:会话锁和超时都要真的进到「调模型」那一步才测得到。请用 monkeypatch 把 `main.run_turn` 换成一个只 sleep 的假实现,写两个测试:同一客户第二条消息返回 409;单轮超时设成 0.2 秒时,流里出现 `"code": "timeout"`。要求假 key 下全过。

<details><summary>参考答案</summary>

我第一版把两个测试都写成了 `async def test_...`,跑出来是这样:

```text
async def functions are not natively supported.
You need to install a suitable plugin for your async framework, for example:
  - anyio
  - pytest-asyncio
FAILED tests/test_service_slow.py::test_second_message_is_409 - Failed: async...
2 failed, 4 passed in 2.51s
```

pytest 本身不会跑异步测试函数。可以装插件,但更简单的办法是测试函数保持普通函数,里面用 `asyncio.run(...)` 跑一个异步的辅助函数,和你在普通脚本里跑异步代码一样([Day 67](/blog/agent-zero/day-067-async-2/))。改好的版本:

```python
# agent-zero-lab/tests/test_service_slow.py
"""会话锁 409 和单轮超时:把 run_turn 换成只会 sleep 的假货,一分钱不花。"""
import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from part07.service import main


async def slow_turn(*args: Any, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "status", "step": 1}
    await asyncio.sleep(0.5)
    yield {"type": "done", "tokens_in": 0, "tokens_out": 0, "cost": 0.0}


async def two_messages() -> tuple[int, str]:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        headers = {"X-Demo-Customer": "C031"}
        first = asyncio.create_task(client.post("/api/chat", headers=headers, json={"text": "一"}))
        await asyncio.sleep(0.1)
        second = await client.post("/api/chat", headers=headers, json={"text": "二"})
        return second.status_code, (await first).text


def test_second_message_is_409(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "run_turn", slow_turn)
    status, first_body = asyncio.run(two_messages())
    assert status == 409
    assert "event: done" in first_body


def test_turn_timeout_becomes_error_event(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setattr(main, "run_turn", slow_turn)
    monkeypatch.setattr(main, "settings", main.Settings(turn_timeout=0.2))
    r = TestClient(main.app).post("/api/chat", headers={"X-Demo-Customer": "C007"}, json={"text": "hi"})
    assert r.status_code == 200
    assert '"code": "timeout"' in r.text
```

<div class="line-notes">

- `async def slow_turn(*args: Any, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:` 假的 `run_turn`。`*args, **kwargs` 表示什么参数都收下不管,这样不用和真函数的五个参数一一对上。它和真的一样是异步生成器:先吐一个 status,睡 0.5 秒,再吐 done。
- `await asyncio.sleep(0.5)` 这 0.5 秒就是「模型正在想」的替身。锁在这段时间里一直被占着。
- `transport = httpx.ASGITransport(app=main.app)` 让 httpx 的异步客户端直接把请求交给 FastAPI 应用,不起服务、不开端口。`TestClient` 是同步的,没法同时发两个请求,所以这个测试换成它。
- `first = asyncio.create_task(` 把第一个请求放到后台跑,不等它结束。相当于 JS 里调了一个 async 函数但先不 await,拿到一个 Promise。
- `await asyncio.sleep(0.1)` 等 0.1 秒,保证第一个请求已经进了 `stream()`、拿到了锁。
- `second = await client.post("/api/chat", headers=headers, json={"text": "二"})` 同一个客户 C031 的第二条。
- `return second.status_code, (await first).text` 这时再等第一个请求跑完,取它的响应正文。
- `monkeypatch.setattr(main, "run_turn", slow_turn)` 把 `main` 模块里的名字 `run_turn` 换成假的。`chat()` 里写的是 `run_turn(...)`,运行时按名字到模块里找,所以换得掉。测试结束 monkeypatch 自动换回来。
- `assert status == 409` 第二条被会话锁挡下。
- `assert "event: done" in first_body` 第一条不受影响,正常结束。
- `monkeypatch.setattr(main, "settings", main.Settings(turn_timeout=0.2))` 换一份单轮超时只有 0.2 秒的配置。Settings 是 `frozen` 的,不能改字段,只能整个换一份新的。
- `assert '"code": "timeout"' in r.text` 0.5 秒的假模型撞上 0.2 秒的超时,流里应该出现 timeout 事件,而且状态码仍是 200(流开始后改不了状态码,Day 432 讲过)。

</div>

```bash
LLM_API_KEY=sk-not-used uv run pytest -q
```

```text
......                                                                   [100%]
6 passed in 2.81s
```

六个测试全过,一分钱没花。为了确认 409 的测试真的在测锁,我把 `main.py` 里的 `if lock.locked():` 临时改成 `if False and lock.locked():`(等于把这道闸门拆了)再跑:

```text
>       assert status == 409
E       assert 200 == 409
FAILED tests/test_service_slow.py::test_second_message_is_409 - assert 200 ==...
1 failed, 1 passed in 3.32s
```

拆了闸门测试就红,说明它没有白写。改回去。这种「故意改坏代码,看测试会不会红」的做法值得养成习惯,一个改坏了也不红的测试,比没有测试更危险,因为它让你放心。

</details>

### 练习 4:拿本周的数字算一笔账,回答一个面试题

面试官问:「你这个查账服务,为什么不自己部署开源模型?」请用 Day 432 冒烟实测的 token 数(我今天又跑了一次:输入 893、输出 208)套 Day 428 的打平算式,算出每天要多少轮对话自部署才划算,再用一两句话回答。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/review62_cost.py
"""用 Day 432 冒烟实测的 token 数,套 Day 428 的打平算式。"""
PRICE_HIT, PRICE_MISS, PRICE_OUT = 0.006, 0.30, 1.20  # deepseek-flash 忙时,美元/百万 token
GPU_DAY = 0.34 * 24                                     # RunPod 最低档 4090,一天
TOKENS_IN, TOKENS_OUT = 893, 208                        # 今天冒烟那一轮

for hit in (0.0, 0.8):
    per_req = (TOKENS_IN * (hit * PRICE_HIT + (1 - hit) * PRICE_MISS) + TOKENS_OUT * PRICE_OUT) / 1_000_000
    print(f"缓存命中 {hit:.0%}:一轮 ${per_req:.6f},打平要每天 {GPU_DAY / per_req:,.0f} 轮")
```

<div class="line-notes">

- `PRICE_HIT, PRICE_MISS, PRICE_OUT = 0.006, 0.30, 1.20` Day 428 查的 DeepSeek 美元价,和那天一致。
- `GPU_DAY = 0.34 * 24` 最便宜那档显卡开一整天:8.16 美元。自部署要 24 小时开着。
- `TOKENS_IN, TOKENS_OUT = 893, 208` 今天跑 smoke 那一轮的实测值。
- `for hit in (0.0, 0.8):` 算两种情况:完全没命中缓存,和命中 80%。
- `per_req = (TOKENS_IN * (hit * PRICE_HIT + (1 - hit) * PRICE_MISS) + TOKENS_OUT * PRICE_OUT) / 1_000_000` 代入 0%:(893 × 0.30 + 208 × 1.20) ÷ 1,000,000 = (267.9 + 249.6) ÷ 1,000,000 = 0.0005175 美元。
- `print(f"缓存命中 {hit:.0%}:` `:.0%` 把 0.8 打印成 `80%`。`{GPU_DAY / per_req:,.0f}` 是 8.16 ÷ 每轮的钱,带千分位、不留小数。

</div>

```text
缓存命中 0%:一轮 $0.000517,打平要每天 15,768 轮
缓存命中 80%:一轮 $0.000307,打平要每天 26,539 轮
```

注意一个反直觉的地方:**缓存命中率越高,自部署越难打平**,因为 API 变便宜了。我们这个服务的 system prompt 和工具定义每轮都一样,命中率高是常态。

回答示范:「按我们实测一轮 893 个输入、208 个输出 token,用 DeepSeek 一轮大约 0.0003 到 0.0005 美元;最便宜的一张 4090 开一天 8 美元,要每天一万六到两万六千轮才打平,还没算运维的人力。我们的量远到不了,所以用 API。真要自部署,理由会是数据不能出去或者要用微调模型,不是省钱。」能把数字说出来,比说「API 方便」有分量得多。

</details>

**验收标准**:默写的 `deploy.yml` 过 actionlint 且 review62 前五项全 OK;默写的 `chat()` 过 `test_service_guards.py`;`review62` 14/14;`tests/` 下六个测试在假 key 下全过,并且拆掉锁那一行时 409 测试会红;能不看文章说出练习 4 的打平点数量级。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 发版前检查 | 发布新版本前跑的一组自动检查,今天的 review62 把流水线规则、厂商配置和预检清单合在一起 |
| 规则检查和语法检查 | 语法检查(actionlint)看文件写得对不对;规则检查看写得合不合团队约定,比如部署必须等测试 |
| ASGITransport | httpx 的一种传输方式,把请求直接交给 FastAPI 应用,不起服务不开端口,能同时发多个异步请求 |
| 改坏验证 | 故意把被测代码改错,确认测试会变红,用来证明测试真的在测东西 |
| 打平点 | 自部署和用 API 每月花费相等时的请求量,低于它用 API 更省 |

本周其他术语(workflow、job、step、action、GHCR、Secrets、Ollama、托管运行时、custom tool、ChatClient、AiServices、ChatModelAgent、上线检查清单、冒烟测试、预检脚本)在各自那一天的名词表里,复习时回去看。

## 常见误区

**复习就是把六篇文章再读一遍。** 读的时候每句都懂,合上就写不出 `needs: test` 该放在哪一层缩进。复习要动手默写,写不出来的地方才是你真的没掌握的地方。

**actionlint 过了,流水线就没问题。** 它不知道你的团队规则。今天练习 1 删掉 `needs: test`,它照样 0 报错。规则要用自己的脚本或者评审来守。

**预检脚本写了就等于在用。** Day 432 写了 `preflight.py`,说了要接进 CI,但直到今天 `ci.yml` 里都没有它。一个只在你本机偶尔跑一次的检查,挡不住同事、也挡不住周五晚上着急的你。

**CI 里也要放真 key,测试才跑得起来。** 闸门测试和预检都不调模型,给 `ci-dummy` 就够了。真 key 放进 CI 就多了一个泄露的地方,真要跑花钱的评测,用 Secrets 并且只在定时任务里跑(Day 427 最后一条误区)。

**`.gitignore` 写了 `.env` 就万事大吉。** 改过名的 `.env.hold`、`.env.bak` 照样会被 `git add .` 带进去。写 `.env*` 加 `!.env.example`。

**把三个岔路口混成一个问题。** 「要不要自部署模型」「要不要用托管运行时」「要不要用 Java 写」是三个独立的决定,判断依据也不同:第一个看量和数据,第二个看控制和合规,第三个看迭代频率和谁值班。面试被问到其中一个,别用另一个的理由回答。

**写 `async def test_...` 以为 pytest 会自己跑。** 没装插件时它直接报 `async functions are not natively supported`。要么装 anyio / pytest-asyncio 插件,要么像练习 3 那样在普通测试函数里 `asyncio.run`。

## 学习资料

### 文档与文章

- [GitHub Docs · Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax):复习 `needs`、`permissions`、`concurrency` 三个关键字时查这一页,每个都有一小段示例。20 分钟。
- [actionlint 的检查项列表](https://github.com/rhysd/actionlint/blob/main/docs/checks.md):看完你会更清楚它查什么、不查什么,也就知道哪些规则要自己写。15 分钟。
- [Ollama · OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility):Day 428 那个参数坑的出处,复习时再确认一遍 `reasoning_effort` 的写法。
- [The Twelve-Factor App(中文)· 配置](https://12factor.net/zh_cn/config):「配置和代码严格分离」,今天的 CI 假变量、厂商配置文件都是这一条的应用。10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hv421y76T&autoplay=0&high_quality=1" title="5分钟带你真正的搞明白什么是CI/CD？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DevOps架构师阿良 · 5分钟带你真正的搞明白什么是CI/CD? · 4 分钟。复习日开头看,用它检验你能不能把 CI、持续交付、持续部署三个词讲清楚,再对照今天知识地图下面那一条线。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dq4y1U7mN&autoplay=0&high_quality=1" title="【IT老齐035】到底什么是蓝绿、红黑、灰度发布？留给发布部署的颜色不多啦！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 到底什么是蓝绿、红黑、灰度发布? · 20 分钟。Day 427 第六步列了「我们的流水线还缺什么」,其中没有灰度、回滚靠手动;这个视频讲公司里这几种发布方式分别怎么做,补上那一段的背景。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/scEDHsr3APg" title="DevOps CI/CD Explained in 100 Seconds" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · DevOps CI/CD Explained in 100 Seconds · 英文,不到 3 分钟。节奏很快,适合默写完 deploy.yml 之后看一遍,检查自己有没有漏掉哪个环节。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章:Day 432 推荐过。复习日再翻一次它的架构演进图,这一周的「模型层、运行时层」两个岔路口在图里都有对应。
- Nicole Forsgren、Jez Humble、Gene Kim《Accelerate》(IT Revolution, 2018):用调研数据讲为什么频繁、小批量、自动化的发版更稳。我没能确认简体中文版的书名和出版社,这里只写英文原版(台湾有旗標出版的繁体版)。挑「持续交付」那几章读,1 小时。

### 开源项目与代码

- [rhysd/actionlint](https://github.com/rhysd/actionlint):今天用的 v1.7.12,README 里有各平台的安装方法。
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):明天之后要开始的毕业项目是客服场景,这是客服 Agent 的公开基准,先收藏,Day 435 会讲为什么提它。

## 自测

1. 不看文章说出:这一周三个「自建还是租」的岔路口,各自最该看的判断依据是什么?

<details><summary>答案</summary>

模型层(Day 428)看请求量和数据:按最便宜的卡算,每天一万五千次以上才可能打平,所以真正的理由通常是数据不能出去或者要用微调模型。运行时层(Day 429)看锁定、可观测、数据合规、调试控制四件事,运行时本身的费用往往只是模型费的零头。语言层(Day 430–431)看 Agent 是不是核心、要不要频繁迭代,以及半夜出问题谁值班:是核心、常迭代就拆 Python 服务,只是辅助功能就内嵌到 Java/Go 里复用事务和权限。

</details>

2. actionlint 0 报错、review62 第二项却 FAIL,可能是什么情况?为什么 actionlint 不管?

<details><summary>答案</summary>

`deploy` job 没有 `needs: test`。两个 job 没有依赖关系时会同时开始,这在语法上合法,所以 actionlint 不报错;但它违反了「测试通过才部署」这条团队规则,规则只能自己写脚本或在评审里守。

</details>

3. 练习 3 里,为什么会话锁的测试要用 `httpx.ASGITransport` 加 `AsyncClient`,而 Day 432 的闸门测试用 `TestClient` 就够了?

<details><summary>答案</summary>

会话锁要在第一个请求还没结束时发第二个请求,必须能并发。`TestClient` 是同步的,`post` 会一直等到响应结束才返回,发不出「同时在跑」的两个请求。`AsyncClient` 配 `ASGITransport` 可以用 `asyncio.create_task` 让第一个在后台跑,再发第二个。401、413、429 这几道闸门在第一个请求里就能判断,不需要并发。

</details>

4. 你把 `.env` 改名成 `.env.local` 方便本地调试,会出什么问题?你会怎么防?

<details><summary>答案</summary>

`.gitignore` 里只有 `.env` 这一行时,`.env.local` 不会被忽略,`git add .` 会把真 key 提交上去,进了 git 历史删文件也没用,只能作废 key。防法:`.gitignore` 写 `.env*` 并加 `!.env.example` 放行示例文件;同时保留 preflight 的「仓库里没有明文 key」那一项,它扫的是所有文件,今天就抓到了 `.env.hold`。

</details>

5. **面试题**:「你的 Agent 服务从改代码到上线经过哪些步骤?哪些是自动的?」请用一分钟回答。

<details><summary>答案</summary>

推到 main 后 GitHub Actions 先跑 test job:按 `uv.lock` 装依赖、跑 pytest(包括不调模型的闸门测试)、跑预检脚本,检查超时嵌套、身份不在工具参数里、Dockerfile 不用 root、`.env` 不进 git 等八项。测试通过才进 deploy job,它只有读代码和写镜像仓库两项权限,用提交哈希当标签构建镜像推到 GHCR,再用一把 CI 专用的 SSH key 登服务器,`docker compose pull` 加 `up -d` 只换 api 容器;部署有并发控制,两次推送会排队。部署后跑冒烟脚本确认核心对话能完成。出问题有一个手动 workflow,输入上一个好版本的哈希就能回滚。发版前我本地还有一个规则检查脚本,查 actionlint 不管的东西,比如部署是不是等测试、厂商参数是不是跟着厂商换了。

</details>

## 明天预告

明天是 Day 434 · 小项目(二):部署到公网和故障演练,也是第七部分的最后一天。今天确认了装备齐全:流水线规则、预检、测试都是绿的。明天把这个服务真正放到 Caddy 后面、加上按 IP 限流,然后按 game day 的做法,先写下「我预期会发生什么」,再一个个把它弄坏:杀进程、让上游变慢和 429、把数据库和审计日志弄坏、客户端中途断开,看实际和预期差在哪。
