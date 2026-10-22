---
title: 'Day 427 · 部署(五):最小 CI/CD'
description: '把「改代码 → 跑测试 → 打镜像 → 登服务器重启」这串手工活交给 GitHub Actions:先看懂 workflow 文件就是一份按顺序执行的命令清单,用 Python 把它读成 JSON、自己模拟跑一遍,用 actionlint 在推送前抓错;再加一个部署 job,推到 main 就自动构建镜像、SSH 上服务器换新版本,顺手做一个手动回滚按钮。'
pubDate: 2026-10-22
regime: none
tags: ['ci-cd', 'github-actions', 'deploy', 'yaml', 'agent-zero']
series: 'agent-zero'
day: 427
lang: 'zh'
draft: true
---

## 上一课回顾

上周([Day 426 · 第 61 周复习](/blog/agent-zero/day-426-week61-review/))我们把服务从笔记本搬上了公网:[Day 420](/blog/agent-zero/day-420-linux-1/) 用 SSH 登上云服务器、建了 `deploy` 用户,[Day 422](/blog/agent-zero/day-422-dockerfile-prod/) 写了小而安全的 Dockerfile,[Day 423](/blog/agent-zero/day-423-compose-prod/) 用 compose 一条命令拉起整套服务,[Day 424](/blog/agent-zero/day-424-secrets-mgmt/) 把密钥从代码和镜像里请了出去,[Day 425](/blog/agent-zero/day-425-deploy-route/) 选了一条部署路线配上 HTTPS。

现在每次上线,你都要手工做一串事:本地跑测试,登服务器,`git pull`,`docker compose up -d --build`,看日志。做三次你就会烦,做到第十次你一定会有一次忘了跑测试。今天把这串手工活交给机器。

## 今天要解决的问题

学完今天你应该能:

1. 看懂一个 GitHub Actions 的 workflow 文件:它在什么时候触发、在哪台机器上跑、按什么顺序执行哪些命令。能用 Python 把它读成 JSON,自己模拟执行一遍。
2. 在推送之前用 actionlint 把 workflow 里的拼写错误、缩进错误、引用错的 job 名找出来。
3. 写一个两段式的流水线:`test` 通过后才跑 `deploy`,`deploy` 构建镜像、推到 GitHub 的镜像仓库、SSH 上服务器换成新版本;再写一个手动触发的回滚 workflow。

预计用时 2–2.5 小时。前置:[Day 56](/blog/agent-zero/day-056-git-1/)–[Day 58](/blog/agent-zero/day-058-git-3/) 的 git 和 GitHub、[Day 71](/blog/agent-zero/day-071-pytest-1/) 起的 pytest、[Day 101](/blog/agent-zero/day-101-docker-2/) 的镜像、上一周 Day 420–425 的服务器和部署。没有 GitHub 仓库和服务器也能学完前两条,第三条可以只读懂、用 actionlint 检查过就算过。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `ci.yml` 和 `deploy.yml` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## CI/CD 是什么:你其实已经用过

先从你熟悉的东西说起。你在前端项目里大概率用过 Vercel 或 Netlify:把仓库连上去,以后每次 `git push`,它自己拉代码、`npm ci`、`npm run build`,几十秒后新版本就上线了;如果你开了个 PR,它还会给这个 PR 单独部署一个预览地址。你没登过任何服务器,也没手动传过一个文件。

这就是 CI/CD。拆开说:

- **CI**(Continuous Integration,持续集成):每次有人推代码或开 PR,机器自动把代码拉下来、装依赖、跑测试,告诉你「这次改动有没有把东西弄坏」。GitHub 上 PR 页面那个绿色对勾或红色叉,就是 CI 的结果。
- **CD**(Continuous Delivery / Deployment,持续交付 / 持续部署):测试通过之后,机器自动把新版本打包、发布到服务器。Delivery 是「打包好了,等人点一下才上线」,Deployment 是「连这一下也不用点」。今天做的是后者的简化版。

Vercel 把这些都藏起来了,因为前端产物就是一堆静态文件,它知道怎么处理。我们的 Agent 服务是一个 Python 进程加 Postgres,跑在我们自己租的服务器上,没有人替我们藏,所以要自己写这份「推送之后做什么」的清单。写这份清单的工具,今天用 **GitHub Actions**:GitHub 自带的、在你推代码时帮你租一台临时虚拟机、按你写的清单执行命令的服务。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次 git push 之后 CI/CD 流水线的走向">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="16" y="30" width="110" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="71" y="50" text-anchor="middle" fill="var(--ink)">你的笔记本</text>
    <text x="71" y="66" text-anchor="middle" fill="var(--ink-soft)">git push main</text>
    <line x1="126" y1="52" x2="160" y2="52" stroke="var(--ink-soft)"/>
    <rect x="160" y="20" width="300" height="140" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="310" y="40" text-anchor="middle" fill="var(--ink)">GitHub Actions 临时虚拟机</text>
    <rect x="176" y="54" width="120" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
    <text x="236" y="74" text-anchor="middle" fill="var(--ink)">job: test</text>
    <text x="236" y="90" text-anchor="middle" fill="var(--ink-soft)">uv sync / pytest</text>
    <line x1="296" y1="76" x2="324" y2="76" stroke="var(--mem)"/>
    <text x="310" y="70" text-anchor="middle" fill="var(--ink-faint)" font-size="11">绿</text>
    <rect x="324" y="54" width="120" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--mem)"/>
    <text x="384" y="74" text-anchor="middle" fill="var(--ink)">job: deploy</text>
    <text x="384" y="90" text-anchor="middle" fill="var(--ink-soft)">build / push</text>
    <text x="236" y="130" text-anchor="middle" fill="var(--ink-faint)" font-size="11">红了就停在这里</text>
    <text x="384" y="130" text-anchor="middle" fill="var(--ink-faint)" font-size="11">needs: test</text>
    <rect x="490" y="30" width="134" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="557" y="50" text-anchor="middle" fill="var(--ink)">ghcr.io 镜像仓库</text>
    <text x="557" y="66" text-anchor="middle" fill="var(--ink-soft)">:提交哈希</text>
    <line x1="444" y1="70" x2="490" y2="56" stroke="var(--compute)"/>
    <rect x="490" y="110" width="134" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="557" y="130" text-anchor="middle" fill="var(--ink)">你的服务器</text>
    <text x="557" y="148" text-anchor="middle" fill="var(--ink-soft)">compose pull/up</text>
    <line x1="444" y1="86" x2="490" y2="128" stroke="var(--compute)"/>
    <text x="466" y="120" fill="var(--ink-faint)" font-size="11">ssh</text>
    <line x1="557" y1="74" x2="557" y2="110" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="565" y="96" fill="var(--ink-faint)" font-size="11">拉镜像</text>
  </g>
  <text x="320" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">CI = 左半段(测试),CD = 右半段(打包、发布、换版本)</text>
  <text x="320" y="224" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是 GitHub 租给你的机器,琥珀色是你自己的外部系统</text>
</svg>
<figcaption>今天要搭的流水线。test 和 deploy 是两个 job,各自在一台全新的临时虚拟机上跑;deploy 靠 needs 等 test 变绿才开始。</figcaption>
</figure>

GitHub Actions 要不要钱?我 2026 年 10 月查的 [GitHub 计费文档](https://docs.github.com/en/billing/concepts/product-billing/github-actions):公开仓库用 GitHub 提供的标准虚拟机**免费**;私有仓库个人免费版每月送 2,000 分钟,Pro 是 3,000 分钟。我们今天的测试 job 一次不到一分钟,部署 job 构建镜像大概几分钟,一个月推几十次也用不完。

## 第一步:最小的 CI,只跑测试

先只做左半段。准备一个最小的服务和一个测试。如果你上周已经有 `part07/service/main.py`,用你自己的就行;没有的话照下面建两个文件。这一步只需要 FastAPI([Day 378](/blog/agent-zero/day-378-agent-api/) 起一直在用)和 pytest:

```bash
cd ~/agent-zero-lab            # 换成你自己的练习仓库路径
uv add fastapi httpx pyyaml    # pyyaml 是第二步读 workflow 用的
uv add --dev pytest
mkdir -p part07/service tests .github/workflows
touch part07/__init__.py part07/service/__init__.py
```

服务只有一个健康检查接口(Day 423 compose 里的健康检查探的就是它):

```python
# agent-zero-lab/part07/service/main.py
from fastapi import FastAPI

app = FastAPI()
VERSION = "0.1.0"


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}
```

<div class="line-notes">

- `from fastapi import FastAPI` 和 Day 378 一样,FastAPI 相当于 Node 里的 Express,只是路由靠装饰器写。
- `VERSION = "0.1.0"` 先写死一个版本号,练习里会改它,看部署后的变化。
- `@app.get("/healthz")` 浏览器访问 `GET /healthz` 时调用下面这个函数。
- `return {"status": "ok", "version": VERSION}` 返回的 dict 会被 FastAPI 转成 JSON,相当于 Express 里的 `res.json({...})`。

</div>

测试用 FastAPI 自带的 `TestClient`,它不真的起服务,直接在进程里模拟一次 HTTP 请求,所以 CI 里不用开端口:

```python
# agent-zero-lab/tests/test_healthz.py
from fastapi.testclient import TestClient

from part07.service.main import app

client = TestClient(app)


def test_healthz_ok() -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
```

<div class="line-notes">

- `from fastapi.testclient import TestClient` 相当于前端测试里的 supertest:把 app 包起来,像发请求一样调用它。
- `from part07.service.main import app` 能这样从仓库根目录导入,是因为 [Day 72](/blog/agent-zero/day-072-pytest-2/) 在 `pyproject.toml` 里配过 `pythonpath = ["."]`。没配的话这里会报 `ModuleNotFoundError: No module named 'part07'`。
- `resp = client.get("/healthz")` 在进程里「请求」一次,不走网络。
- `assert resp.status_code == 200` 第一道检查:接口活着。
- `assert resp.json()["status"] == "ok"` 第二道检查:返回内容对。后面我们会故意把 `ok` 改成 `OK`,看它在这一行失败。

</div>

本地先跑一次,确认是绿的。CI 只是在别人的机器上把同样的命令再跑一遍,本地都不绿,推上去也不会绿:

```bash
uv run pytest -q
```

我在 2019 款 Intel Mac 上实跑的最后几行:

```text
  .../site-packages/fastapi/testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
1 passed, 1 warning in 1.11s
```

`1 passed` 就是通过。那条 warning 是 2026 年 10 月这几个库版本(fastapi 0.159.1、starlette 1.9.0)之间的一个弃用提醒,说以后 TestClient 要换用 `httpx2` 这个包,现在不影响结果,先放着。

现在写今天的主角。在仓库根目录建 `.github/workflows/ci.yml`。路径必须一字不差:GitHub 只认 `.github/workflows/` 这个目录下的 `.yml` 或 `.yaml` 文件。

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
```

<div class="line-notes">

- `name: ci` 这个 workflow 的名字,会显示在 GitHub 仓库的 Actions 标签页里。
- `on:` 什么时候触发。下面两种:推送,和开 PR。
- `branches: [main]` 只有推到 main 分支才触发。推到别的分支不跑(但开 PR 会跑,见下一行)。
- `pull_request:` 后面什么都不写,意思是「任何 PR 都触发」。这一行解析出来的值是 `null`,下一步你会亲眼看到。
- `jobs:` 一个 workflow 可以有多个 job,每个 job 在**一台全新的虚拟机**上跑,互相之间不共享文件。
- `test:` job 的名字,自己起。后面 `needs: test` 引用的就是它。
- `runs-on: ubuntu-latest` 租哪种机器。`ubuntu-latest` 是 GitHub 提供的 Linux 虚拟机,上面预装了 git、curl、Docker 等常用工具,但没有 uv。
- `steps:` 这个 job 要按顺序做的事,一条一个 `-`。
- `- uses: actions/checkout@v7` `uses` 是「用别人写好的一个 action」。checkout 把你仓库的代码拉到虚拟机里,不写这一步,虚拟机里是空的。`@v7` 是版本,2026 年 10 月查到的最新大版本是 v7(v7.0.1)。
- `- uses: astral-sh/setup-uv@v10` 在虚拟机上装 uv。uv 官方出的 action,2026 年 10 月最新是 v10.3.1。
- `- run: uv sync --locked` `run` 就是在终端里执行一条命令。`--locked` 的意思是「严格按 uv.lock 装,lock 文件和 pyproject.toml 对不上就直接失败」,相当于前端的 `npm ci`。
- `- run: uv run pytest -q` 跑测试。pytest 退出码不为 0,这一步就失败,整个 job 标红。

</div>

这里有三个词要分清:**workflow** 是整个文件;**job** 是一台虚拟机上跑的一组步骤;**step** 是其中一步,要么 `uses` 一个现成的 action,要么 `run` 一条命令。**action** 就是别人打包好的一段可复用步骤,`actions/checkout` 是 GitHub 官方写的,`astral-sh/setup-uv` 是 uv 的作者写的,相当于 npm 上别人发布的包,`@v7` 相当于锁大版本号。

把它推上去(Day 58 学过的流程):

```bash
git add .github/workflows/ci.yml part07 tests pyproject.toml uv.lock
git commit -m "ci: run pytest on push"
git push origin main
```

然后打开 GitHub 仓库页面,点上方的 **Actions** 标签,能看到一条正在跑的记录,点进去能看到每一步的日志,和你本地终端里的输出一样。跑完之后,提交记录旁边会出现绿色对勾。

这里我自己第一次就踩了一个坑:我的练习仓库是 `uv init` 建的,`git status` 一看,当前分支叫 **master** 而不是 main(取决于你本机 git 的 `init.defaultBranch` 配置)。推到 master,而 workflow 写的是 `branches: [main]`,结果 Actions 页面空空如也,一点报错都没有。先用 `git branch --show-current` 看一眼,不是 main 就 `git branch -M main` 改名。

## 第二步:workflow 文件就是一份 JSON

YAML 对前端来说可能有点陌生,但它其实就是**换了一种写法的 JSON**:缩进代表嵌套,`key: value` 是对象的属性,`- ` 开头的是数组元素。前面 [Day 102](/blog/agent-zero/day-102-docker-3/) 写 compose 文件时已经见过。不信的话,我们用 Python 把它读出来,转成 JSON 打印:

```python
# agent-zero-lab/part07/read_workflow.py
import json
from pathlib import Path

import yaml

text = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")
wf = yaml.safe_load(text)
print(json.dumps(wf, ensure_ascii=False, indent=2, default=str))
print("顶层的键:", list(wf.keys()))
```

<div class="line-notes">

- `import yaml` 就是第一步 `uv add` 的 pyyaml 包,导入名叫 `yaml`。相当于 JS 里的 `js-yaml`。
- `text = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")` 相对路径,所以要在仓库根目录运行。
- `wf = yaml.safe_load(text)` 把 YAML 文本变成 Python 的 dict/list,相当于 `JSON.parse`。用 `safe_load` 不用 `load`:后者能在 YAML 里构造任意 Python 对象,读不可信的文件很危险。
- `print(json.dumps(wf, ensure_ascii=False, indent=2, default=str))` 再转成带缩进的 JSON 打印,相当于 `JSON.stringify(wf, null, 2)`。
- `print("顶层的键:", list(wf.keys()))` 实跑结果是 `['name', True, 'jobs']`,注意中间那个。

</div>

```bash
uv run python part07/read_workflow.py
```

实跑输出:

```text
{
  "name": "ci",
  "true": {
    "push": {
      "branches": [
        "main"
      ]
    },
    "pull_request": null
  },
  "jobs": {
    "test": {
      "runs-on": "ubuntu-latest",
      "steps": [
        {
          "uses": "actions/checkout@v7"
        },
        {
          "uses": "astral-sh/setup-uv@v10"
        },
        {
          "run": "uv sync --locked"
        },
        {
          "run": "uv run pytest -q"
        }
      ]
    }
  }
}
顶层的键: ['name', True, 'jobs']
```

对照着看,每一层缩进都变成了一层 `{}`,每个 `- ` 都变成了数组里的一个元素。`steps` 就是一个数组,数组里每个元素是一个只有一个键的对象。

再看那个怪东西:我们写的是 `on:`,读出来变成了布尔值 `True`(JSON 里打印成 `"true"`)。这是 YAML 1.1 规范的老毛病,它把 `on`、`off`、`yes`、`no` 都当成布尔值,PyYAML 照规范办事。GitHub 自己的解析器认识这个情况,所以 workflow 本身没问题;但如果以后你写脚本读 workflow,要用 `wf[True]` 去取触发条件,`wf["on"]` 会报 `KeyError`。这个坑在第三步的模拟器里不会碰到,因为我们只读 `jobs`。

## 第三步:自己当一回 Actions,模拟跑一遍

GitHub 那台虚拟机到底做了什么?说穿了就是按顺序执行 `steps`,哪一步的命令退出码不是 0 就停下来标红。我们用二十几行 Python 在本机模拟一遍,跑完你就不会觉得 Actions 神秘了。

这段用到 `subprocess`:Python 标准库里「起一个子进程执行一条终端命令」的模块,相当于 Node 的 `child_process.execSync`。

```python
# agent-zero-lab/part07/mini_runner.py
import subprocess
import sys
import time
from pathlib import Path

import yaml

wf = yaml.safe_load(Path(".github/workflows/ci.yml").read_text(encoding="utf-8"))

for job_name, job in wf["jobs"].items():
    print(f"== job: {job_name}(真 Actions 会在 {job['runs-on']} 上跑)")
    for i, step in enumerate(job["steps"], start=1):
        if "uses" in step:
            print(f"  [{i}] 跳过 uses: {step['uses']}(本机已经有代码和 uv)")
            continue
        start = time.perf_counter()
        result = subprocess.run(step["run"], shell=True, capture_output=True, text=True)
        cost = time.perf_counter() - start
        last = (result.stdout + result.stderr).strip().splitlines()[-1:]
        print(f"  [{i}] run: {step['run']} -> 退出码 {result.returncode},{cost:.1f}s,最后一行:{last}")
        if result.returncode != 0:
            print("  这一步失败,后面的步骤都不跑,整个 job 标红")
            sys.exit(1)
print("全部步骤通过,GitHub 上会显示绿色对勾")
```

<div class="line-notes">

- `import subprocess` 执行外部命令的标准库。
- `wf = yaml.safe_load(` 和上一个脚本一样把 workflow 读成 dict。
- `for job_name, job in wf["jobs"].items():` `.items()` 同时拿到键和值,相当于 JS 的 `Object.entries(wf.jobs)`。这里只有一个 job:`job_name = "test"`。
- `print(f"== job: {job_name}` 实跑打印 `== job: test(真 Actions 会在 ubuntu-latest 上跑)`。
- `for i, step in enumerate(job["steps"], start=1):` `enumerate` 给每个元素配一个序号,从 1 开始数,相当于 `steps.forEach((step, idx) => ...)` 再加 1。
- `if "uses" in step:` 这一步是 `uses` 一个 action。checkout 和 setup-uv 在本机不需要(代码就在这,uv 也装了),直接跳过。
- `continue` 跳到下一步,相当于 JS 循环里的 `continue`。
- `start = time.perf_counter()` 记下开始时间,用来算这一步花了几秒。
- `result = subprocess.run(step["run"], shell=True, capture_output=True, text=True)` 关键一行。`shell=True` 让整条命令交给 shell 解释,和你在终端里敲一样;`capture_output=True` 把输出收进 `result.stdout` / `result.stderr`,不直接打到屏幕;`text=True` 让输出是字符串而不是字节。
- `last = (result.stdout + result.stderr).strip().splitlines()[-1:]` 只取最后一行输出,对 pytest 来说就是那句 `1 passed ...`。`[-1:]` 是「从最后一个取到末尾」,得到一个只有一个元素的列表。
- `print(f"  [{i}] run:` 实跑第 4 步打印 `退出码 0,2.2s,最后一行:['1 passed, 1 warning in 0.90s']`。
- `if result.returncode != 0:` **整个 CI 的判断标准就是退出码**。pytest 有测试失败时退出码是 1,`uv sync --locked` 发现 lock 对不上时也是 1。
- `sys.exit(1)` 我们的模拟器自己也用非 0 退出,外层再有人调它也知道失败了。

</div>

实跑(本机,测试是绿的时候):

```text
== job: test(真 Actions 会在 ubuntu-latest 上跑)
  [1] 跳过 uses: actions/checkout@v7(本机已经有代码和 uv)
  [2] 跳过 uses: astral-sh/setup-uv@v10(本机已经有代码和 uv)
  [3] run: uv sync --locked -> 退出码 0,0.1s,最后一行:['Checked 21 packages in 1ms']
  [4] run: uv run pytest -q -> 退出码 0,2.2s,最后一行:['1 passed, 1 warning in 0.90s']
全部步骤通过,GitHub 上会显示绿色对勾
```

现在故意弄坏。把 `main.py` 里的 `"status": "ok"` 改成 `"status": "OK"`,再跑一次:

```text
== job: test(真 Actions 会在 ubuntu-latest 上跑)
  [1] 跳过 uses: actions/checkout@v7(本机已经有代码和 uv)
  [2] 跳过 uses: astral-sh/setup-uv@v10(本机已经有代码和 uv)
  [3] run: uv sync --locked -> 退出码 0,0.1s,最后一行:['Checked 21 packages in 2ms']
  [4] run: uv run pytest -q -> 退出码 1,2.2s,最后一行:['1 failed, 1 warning in 1.07s']
  这一步失败,后面的步骤都不跑,整个 job 标红
```

单独跑 `uv run pytest -q` 能看到失败的具体位置,这也是你在 GitHub 日志里会看到的东西:

```text
>       assert resp.json()["status"] == "ok"
E       AssertionError: assert 'OK' == 'ok'
tests/test_healthz.py:12: AssertionError
FAILED tests/test_healthz.py::test_healthz_ok - AssertionError: assert 'OK' =...
```

改回 `ok`。再演示另一种很常见的红:你在 `pyproject.toml` 里手动加了一行依赖,却忘了跑 `uv lock`。我在 `dependencies` 里手写了一行 `"rich>=14.0"`,直接执行 CI 里那条命令:

```text
$ uv sync --locked
Resolved 26 packages in 30ms
error: The lockfile at `uv.lock` needs to be updated, but `--locked` was provided.

hint: To update the lockfile, run `uv lock`.
```

退出码 1。这一步在 CI 里拦下来是好事:它说明你本地的环境和仓库里记录的环境不一样,别人(包括服务器)按 lock 装出来的东西和你测的不是一回事。修法就是提示里说的,本地 `uv lock`(或者一开始就用 `uv add` 加依赖,它会顺手更新 lock),再把 `uv.lock` 一起提交。

## 第四步:推送之前先用 actionlint 查一遍

workflow 写错了,你要推上去、等 GitHub 跑起来,才在网页上看到一行报错。改一次推一次,一来一回几分钟。**actionlint** 是一个专门检查 GitHub Actions workflow 文件的小工具,本地一秒钟出结果,能查出拼错的键名、引用不存在的 job、写错的变量名,相当于给 workflow 用的 ESLint。

它是一个单独的可执行文件,不需要装 Python 包。macOS 上 `brew install actionlint` 最省事;不用 brew 的话,从 [GitHub Releases](https://github.com/rhysd/actionlint) 下载对应系统的压缩包解开就能用。我 2026 年 10 月下载的是 v1.7.12,Intel Mac 选 `darwin_amd64`,Apple 芯片选 `darwin_arm64`:

```bash
mkdir -p ~/tools && cd ~/tools
curl -sL -o al.tgz https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_amd64.tar.gz
tar xzf al.tgz actionlint
./actionlint -version
cd ~/agent-zero-lab && ~/tools/actionlint .github/workflows/ci.yml && echo OK
```

对我们正确的 `ci.yml`,它什么都不输出,退出码 0,所以会打印 `OK`。

为了看它能抓什么,我写了一个错了四处的文件 `bad.yml`:

```yaml
name: bad
on:
  push:
    branches: [main]
jobs:
  test:
    runs_on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: uv run pytest -q
  deploy:
    needs: tests
    runs-on: ubuntu-latest
    steps:
      - run: echo ${{ secret.DEPLOY_HOST }}
```

<div class="line-notes">

- `runs_on: ubuntu-latest` 错一:中划线写成了下划线。
- `needs: tests` 错二:job 叫 `test`,这里多了个 s。
- `- run: echo ${{ secret.DEPLOY_HOST }}` 错三:应该是 `secrets`。`${{ }}` 是 Actions 的表达式语法,第五步细讲。错四是错一带出来的:job 缺了必填的 `runs-on`。

</div>

实跑 `actionlint -no-color .github/workflows/bad.yml` 的输出(原文):

```text
.github/workflows/bad.yml:6:3: "runs-on" section is missing in job "test" [syntax-check]
  |
6 |   test:
  |   ^~~~~
.github/workflows/bad.yml:7:5: unexpected key "runs_on" for "job" section. expected one of "concurrency", "container", "continue-on-error", "defaults", "env", "environment", "if", "name", "needs", "outputs", "permissions", "runs-on", "secrets", "services", "snapshot", "steps", "strategy", "timeout-minutes", "uses", "with" [syntax-check]
  |
7 |     runs_on: ubuntu-latest
  |     ^~~~~~~~
.github/workflows/bad.yml:11:3: job "deploy" needs job "tests" which does not exist in this workflow [job-needs]
   |
11 |   deploy:
   |   ^~~~~~~
.github/workflows/bad.yml:15:23: undefined variable "secret". available variables are "env", "github", "inputs", "job", "matrix", "needs", "runner", "secrets", "steps", "strategy", "vars" [expression]
   |
15 |       - run: echo ${{ secret.DEPLOY_HOST }}
   |                       ^~~~~~~~~~~~~~~~~~
```

四处全抓到了,每条都给出行号、列号和「你应该写什么」。第二条把 job 下面所有合法的键都列了出来,当速查表用也不错。

还有一种错是 YAML 本身的缩进错。下面这个文件,第二个 `- run` 少缩进了一个空格(5 个而不是 6 个):

```text
      - uses: actions/checkout@v7
     - run: uv run pytest -q
```

actionlint 的报错:

```text
.github/workflows/bad2.yml:6:4: could not parse as YAML: did not find expected key [syntax-check]
```

同一个文件给 PyYAML 读,报错是:

```text
yaml.parser.ParserError: while parsing a block mapping
  in ".github/workflows/bad2.yml", line 7, column 5
expected <block end>, but found '<block sequence start>'
  in ".github/workflows/bad2.yml", line 10, column 6
```

两个工具指的行号不完全一样,这是 YAML 缩进错误的通病:解析器发现「不对劲」的位置,往往在真正出错那一行的上面或下面。看到 `did not find expected key` 或 `expected <block end>`,就去报错行附近数空格。编辑器里给 YAML 打开「显示空白字符」很有帮助,而且**永远别用 Tab 缩进 YAML**。

## 第五步:CD,测试通过后自动上线

现在加右半段。思路和你上周手工做的一模一样,只是换成机器做:

1. 在 GitHub 的虚拟机上按 Day 422 的 Dockerfile 构建镜像;
2. 把镜像推到一个镜像仓库,用提交哈希当标签;
3. SSH 登上你的服务器,让 compose 拉这个标签的镜像,重启服务。

用到的镜像仓库是 **GHCR**(GitHub Container Registry,地址 `ghcr.io`):GitHub 自带的放 Docker 镜像的地方,作用和 Docker Hub 一样,好处是和仓库在一起,权限也跟着 GitHub 走。

部署要用到两样不能写进文件的东西:服务器地址和登录服务器的 SSH 私钥。它们放在 GitHub 的 **Secrets** 里:仓库页面 → Settings → Secrets and variables → Actions → New repository secret。和 Day 424 讲的道理一样,密钥不进代码、不进镜像,运行时才注入。今天要建两个:

- `DEPLOY_HOST`:服务器的 IP 或域名;
- `DEPLOY_SSH_KEY`:一把**专门给 CI 用的** SSH 私钥。在本机 `ssh-keygen -t ed25519 -f ~/.ssh/ci_deploy -C ci` 生成一对,公钥 `ci_deploy.pub` 的内容追加到服务器上 `deploy` 用户的 `~/.ssh/authorized_keys`(Day 420 做过同样的事),私钥 `ci_deploy` 的全部内容(包括 BEGIN 和 END 两行)粘进这个 secret。别用你自己日常登服务器的那把,CI 的钥匙泄露了,删掉这一把公钥就能止损。

服务器那边,Day 423 的 `compose.yaml` 里 `api` 服务要改一行,从「在服务器上构建」改成「拉 CI 构建好的镜像」:

```yaml
services:
  api:
    image: ghcr.io/你的GitHub用户名/agent-zero-lab:${IMAGE_TAG:-latest}
    # build: .   ← 原来这一行删掉或注释掉
```

<div class="line-notes">

- `image: ghcr.io/你的GitHub用户名/agent-zero-lab:${IMAGE_TAG:-latest}` `${IMAGE_TAG:-latest}` 是 compose 的变量写法:环境变量 `IMAGE_TAG` 有值就用它,没有就用 `latest`。CI 会把提交哈希塞进 `IMAGE_TAG`。用户名要**全小写**,镜像名里有大写字母会被 Docker 拒绝(报 `repository name must be lowercase`)。
- `# build: .   ← 原来这一行删掉或注释掉` 服务器只负责运行,不再构建。小内存的服务器上构建镜像经常把内存吃光,这也是交给 CI 构建的一个好处。

</div>

GHCR 里的镜像默认是**私有**的,服务器拉之前要登录一次:在 GitHub 网页 Settings → Developer settings → Personal access tokens 建一个只勾 `read:packages` 权限的 token,在服务器上执行一次 `echo 这个token | docker login ghcr.io -u 你的用户名 --password-stdin`。之后 docker 会记住。

然后是完整的 `deploy.yml`。它包含 `ci.yml` 的测试 job,所以有了它可以把 `ci.yml` 里的 `push` 触发删掉,只留 `pull_request`,免得推一次跑两遍测试:

```yaml
# agent-zero-lab/.github/workflows/deploy.yml
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

- `name: test-and-deploy` 这个文件我没有推到真实的 GitHub 仓库跑过(练习仓库不能动站长的 GitHub 账号,本机也没有 Docker)。做过的验证:actionlint v1.7.12 检查 0 报错;用 PyYAML 解析,jobs 是 `['test', 'deploy']`,deploy 的四个步骤依次是 checkout、login-action、build-push-action、Deploy over SSH。
- `concurrency:` 并发控制。你连着推了两次,第二次的部署会排队等第一次结束,不会两个部署同时 SSH 上去改服务器。
- `cancel-in-progress: false` 不要取消正在进行的部署。部署做到一半被掐断,服务器可能停在半新半旧的状态。
- `test:` 和 ci.yml 里的测试 job 一字不差。
- `needs: test` 等 test 成功才开始。test 红了,deploy 直接显示 skipped。
- `permissions:` 给这个 job 发的权限。默认的权限比需要的多,按 [Day 413](/blog/agent-zero/day-413-least-privilege/) 讲的最小权限,只要两样:
- `contents: read` 读代码。
- `packages: write` 往 GHCR 推镜像。实测 PyYAML 解析出来是 `{'contents': 'read', 'packages': 'write'}`。
- `- uses: docker/login-action@v4` 登录镜像仓库。2026 年 10 月最新大版本 v4(v4.6.0)。
- `username: ${{ github.actor }}` `${{ }}` 是 Actions 的表达式,运行时被替换成值。`github.actor` 是触发这次运行的人的用户名。
- `password: ${{ secrets.GITHUB_TOKEN }}` 每次运行 GitHub 自动发一个临时 token,运行结束就失效,不用你自己建。它能干什么,由上面的 `permissions` 决定。
- `- uses: docker/build-push-action@v7` 按仓库根目录的 Dockerfile 构建并推送。2026 年 10 月最新大版本 v7(v7.4.0)。GitHub 的 ubuntu 虚拟机预装了 Docker,所以这里不用自己装。
- `push: true` 构建完推上去。PR 里一般设成 false,只构建不推,检查 Dockerfile 没坏就够了。
- `tags: ghcr.io/${{ github.repository }}:${{ github.sha }}` 标签用提交哈希,比如 `ghcr.io/你的用户名/agent-zero-lab:3f9c2a1...`。每次提交一个独立的镜像,回滚时指定哪个哈希就能回到哪个版本。`latest` 这种会被覆盖的标签,出了事你说不清线上到底跑的是哪一版。
- `env:` 把 secret 先放进环境变量,下面脚本里用 `$SSH_KEY` 读。比直接把 `${{ secrets.X }}` 拼进命令更安全:表达式是在执行之前做文本替换的,值里有特殊字符会把命令弄乱。
- `TAG: ${{ github.sha }}` 这次提交的完整哈希,40 个字符。
- `run: |` YAML 里 `|` 表示下面是多行文本,原样保留换行。这几行会作为一个 shell 脚本执行。
- `install -m 600 /dev/null key` 先建一个权限为 600(只有自己能读写)的空文件。ssh 发现私钥文件别人也能读,会拒绝使用它。
- `echo "$SSH_KEY" > key` 再把私钥写进去。日志里如果出现 secret 的值,GitHub 会自动替换成 `***`。
- `ssh -i key -o StrictHostKeyChecking=accept-new deploy@"$HOST" \` 用这把钥匙登录 deploy 用户。`accept-new`:第一次连接自动记下服务器指纹,以后指纹变了就拒绝,防止有人冒充你的服务器。行尾 `\` 是 shell 的续行符。
- `"cd agent-zero-lab && git pull --ff-only` 引号里的整串命令是在**服务器上**执行的,分三段看。`git pull --ff-only` 先更新代码(compose.yaml 可能也改了),服务器上的代码如果被人手动改过、和远端分叉了就直接失败,不自动合并。`IMAGE_TAG=$TAG docker compose pull api` 拉这次提交的镜像,`$TAG` 在 CI 虚拟机上就被替换成了哈希,到服务器时已经是一串具体字符。最后 `docker compose up -d api` 用新镜像重建 api 容器,Postgres 等其他服务不动。

</div>

用 Day 422 的 Dockerfile 的话,它应该在仓库根目录,build-push-action 默认就找那里;如果你放在别处,`with:` 下面加一行 `file: 路径/Dockerfile`。

本机没法真跑这个部署,但「test 红了 deploy 就不跑」这条规则可以模拟出来。练习 4 会把上面的 `mini_runner.py` 升级成支持 `needs` 的版本,先剧透一下实跑结果,测试坏掉时打印的是:

```text
== job: deploy 跳过,因为 needs 的 test 是 failure
{'test': 'failure', 'deploy': 'skipped'}
```

**上线之后怎么确认?** 在 Actions 页面看到 deploy 变绿,然后访问你的 `https://你的域名/healthz`,返回里的 `version` 应该是你刚改的那个。练习 1 就让你这么做一次。

## 第六步:流水线还缺什么,心里要有数

这个流水线能用,也足够在面试里讲清楚「我的项目从提交到上线经过了哪些步骤」。但它离公司里的做法还差不少,知道差在哪,比假装它完整更重要:

**没有预发环境**。公司里一般先部署到一个和生产一样的 staging 环境,跑一遍冒烟测试再上生产。个人项目一台服务器,省掉了。

**没有灰度**。新版本一次性替换旧版本。公司会先放 5% 的流量给新版本观察。

**回滚靠手动**。我们用提交哈希做标签,回滚已经很容易了,练习 3 把它做成一个按钮。

**评测没进流水线**。Agent 项目和普通 Web 项目最大的不同是:代码测试全绿,换了一句提示词,回答质量照样可能掉。[Day 375](/blog/agent-zero/day-375-eval-project-2/) 做过评测回归门禁,把它接进 `test` job 之前要想清楚成本:每次推送都跑 100 条评测,一天推 20 次就是 2,000 次 Agent 运行。常见做法是推送时只跑确定性测试加 20 条左右的冒烟评测,完整评测每天定时跑一次(`on: schedule`)或者合并前手动触发。还有一点,测试 job 里要调模型的话,API key 也要放进 secrets;能用 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的假对象就别调真模型,CI 里的测试越确定越好。

## 动手练习

**练习 1:改个版本号,看它自动上线。** 把 `main.py` 里的 `VERSION` 改成 `"0.1.1"`,推到 main。在 Actions 页面看着两个 job 先后变绿,然后 `curl https://你的域名/healthz` 确认版本变了。没有服务器的话,改成:本地跑 `mini_runner.py` 确认全绿,再用 TestClient 打印一次 `/healthz` 的返回。

<details><summary>参考答案</summary>

有服务器时的命令:

```bash
sed -i '' 's/VERSION = "0.1.0"/VERSION = "0.1.1"/' part07/service/main.py   # Linux 上去掉 ''
git commit -am "bump version to 0.1.1" && git push origin main
# 等 Actions 页面两个 job 都变绿
curl -s https://你的域名/healthz
```

<div class="line-notes">

- `sed -i '' 's/VERSION = "0.1.0"/VERSION = "0.1.1"/' part07/service/main.py` macOS 自带的 sed 原地修改要写 `-i ''`,Linux 的 GNU sed 写 `-i` 就行。直接用编辑器改也完全可以。
- `git commit -am "bump version to 0.1.1" && git push origin main` `-a` 把已跟踪文件的修改一起加进暂存区,省一次 `git add`。
- `curl -s https://你的域名/healthz` 应该返回 `{"status":"ok","version":"0.1.1"}`。这一段我没有实跑(没有可用的服务器和仓库)。

</div>

没有服务器时的本地版本,我实跑过:

```bash
uv run python part07/mini_runner.py
uv run python -c "from fastapi.testclient import TestClient; from part07.service.main import app; print(TestClient(app).get('/healthz').json())"
```

改版本号之后第二条打印 `{'status': 'ok', 'version': '0.1.1'}`。

</details>

**练习 2:观察 CI 变红。** 新建一个分支,把测试弄坏,开一个 PR(或者在本地用 `mini_runner.py` 模拟),观察会发生什么。

<details><summary>参考答案</summary>

本地模拟的实跑现象上面已经贴过:第 4 步 `uv run pytest -q -> 退出码 1`,打印「这一步失败,后面的步骤都不跑」。在 GitHub 上的现象是:PR 页面底部的检查项显示红叉 `ci / test`,点 Details 进去,日志里能看到和本地一样的 `AssertionError: assert 'OK' == 'ok'`。因为 `deploy.yml` 只在推到 main 时触发,PR 上不会部署,这正是我们想要的:PR 只做检查,合并到 main 才上线。如果仓库设置了分支保护(Settings → Branches → 勾选 Require status checks to pass),红叉的 PR 连合并按钮都点不了。

</details>

**练习 3:做一个回滚按钮。** 写 `.github/workflows/rollback.yml`,在 Actions 页面手动触发,输入一个提交哈希,服务器就换回那个版本的镜像。用 actionlint 检查。

<details><summary>参考答案</summary>

```yaml
# agent-zero-lab/.github/workflows/rollback.yml
name: rollback
on:
  workflow_dispatch:
    inputs:
      tag:
        description: "要回到的提交哈希(镜像标签)"
        required: true
        type: string

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy old image over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          HOST: ${{ secrets.DEPLOY_HOST }}
          TAG: ${{ inputs.tag }}
        run: |
          install -m 600 /dev/null key
          echo "$SSH_KEY" > key
          ssh -i key -o StrictHostKeyChecking=accept-new deploy@"$HOST" \
            "cd agent-zero-lab && IMAGE_TAG=$TAG docker compose pull api && IMAGE_TAG=$TAG docker compose up -d api"
```

<div class="line-notes">

- `workflow_dispatch:` 手动触发。加了它,Actions 页面这个 workflow 旁边会出现一个 **Run workflow** 按钮。
- `inputs:` 点按钮时弹出的输入框。
- `tag:` 输入框的名字,下面用 `inputs.tag` 读。
- `type: string` 输入的是文本。还可以是 `boolean`、`choice` 等。
- `steps:` 回滚不用测试,也不用构建,镜像早就在 GHCR 里了。所以连 checkout 都不需要。
- `TAG: ${{ inputs.tag }}` 你在输入框里填的哈希。去 GitHub 的 commits 页面复制上一个好版本的完整哈希。
- `"cd agent-zero-lab && IMAGE_TAG=$TAG docker compose pull api` 和 deploy.yml 唯一的区别是去掉了 `git pull`:回滚只换镜像,不动服务器上的 compose.yaml。

</div>

actionlint 实跑结果:0 报错。为了确认它真的在检查 `inputs`,我把 `inputs.tag` 故意改成 `inputs.version` 再查,输出:

```text
.github/workflows/rb.yml:19:20: property "version" is not defined in object type {tag: string} [expression]
```

它知道 `inputs` 里只有一个 `tag`。回滚之后记得再访问一次 `/healthz` 确认版本号回去了。这个 workflow 我没有在真实仓库里点过按钮。

</details>

**练习 4:让模拟器支持 `needs`。** 改 `mini_runner.py`,读 `deploy.yml`,按顺序跑 job;如果某个 job 的 `needs` 没成功,就跳过它。`uses` 步骤和带 ssh 的步骤只打印不执行。分别在测试通过和测试失败时跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/mini_runner2.py
import subprocess
import sys
from pathlib import Path

import yaml

path = sys.argv[1] if len(sys.argv) > 1 else ".github/workflows/deploy.yml"
wf = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
status: dict[str, str] = {}

for job_name, job in wf["jobs"].items():
    need = job.get("needs")
    if need and status.get(need) != "success":
        status[job_name] = "skipped"
        print(f"== job: {job_name} 跳过,因为 needs 的 {need} 是 {status.get(need)}")
        continue
    status[job_name] = "success"
    print(f"== job: {job_name}")
    for step in job["steps"]:
        cmd = step.get("run")
        if cmd is None or "ssh" in cmd:
            print(f"  只打印不执行: {step.get('uses') or step.get('name')}")
            continue
        code = subprocess.run(cmd, shell=True, capture_output=True).returncode
        print(f"  run: {cmd} -> 退出码 {code}")
        if code != 0:
            status[job_name] = "failure"
            break
print(status)
```

<div class="line-notes">

- `path = sys.argv[1] if len(sys.argv) > 1 else ".github/workflows/deploy.yml"` 命令行传了路径就用它,否则默认读 deploy.yml。`sys.argv` 相当于 Node 的 `process.argv`,只是少了前面那个 node 路径。
- `status: dict[str, str] = {}` 记录每个 job 的结果,键是 job 名,值是 success / failure / skipped,和 GitHub 页面上的三种状态同名。
- `need = job.get("needs")` `.get` 取不到时返回 `None` 而不是报错。test 没有 needs,得到 `None`;deploy 得到 `"test"`。(真实的 needs 还可以是列表,这里只处理一个字符串的情况。)
- `if need and status.get(need) != "success":` 依赖的 job 不是成功,就跳过。
- `status[job_name] = "success"` 先乐观地记成功,下面哪一步失败再改成 failure。
- `if cmd is None or "ssh" in cmd:` `uses` 步骤没有 `run`,`cmd` 是 None;部署那一步含 ssh,本机不能真的执行。
- `print(f"  只打印不执行: {step.get('uses') or step.get('name')}")` `a or b`:a 是 None 就取 b,相当于 JS 的 `a ?? b`(严格说更像 `a || b`)。
- `code = subprocess.run(cmd, shell=True, capture_output=True).returncode` 只要退出码。
- `break` 一步失败,这个 job 后面的步骤不再跑,和真 Actions 一样。
- `print(status)` 测试通过时实跑打印 `{'test': 'success', 'deploy': 'success'}`;把 `ok` 改成 `OK` 后打印 `{'test': 'failure', 'deploy': 'skipped'}`。

</div>

测试通过时的完整输出:

```text
== job: test
  只打印不执行: actions/checkout@v7
  只打印不执行: astral-sh/setup-uv@v10
  run: uv sync --locked -> 退出码 0
  run: uv run pytest -q -> 退出码 0
== job: deploy
  只打印不执行: actions/checkout@v7
  只打印不执行: docker/login-action@v4
  只打印不执行: docker/build-push-action@v7
  只打印不执行: Deploy over SSH
{'test': 'success', 'deploy': 'success'}
```

测试失败时:

```text
== job: test
  只打印不执行: actions/checkout@v7
  只打印不执行: astral-sh/setup-uv@v10
  run: uv sync --locked -> 退出码 0
  run: uv run pytest -q -> 退出码 1
== job: deploy 跳过,因为 needs 的 test 是 failure
{'test': 'failure', 'deploy': 'skipped'}
```

</details>

**验收标准**:`ci.yml`、`deploy.yml`、`rollback.yml` 三个文件 actionlint 都是 0 报错;能说出 workflow、job、step、action 各是什么;本地模拟器在测试坏掉时会让 deploy 变成 skipped;有 GitHub 仓库和服务器的,推一次 main 后 `/healthz` 的版本号自动变了,并用回滚按钮回去过一次。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| CI(持续集成) | 每次推代码或开 PR,机器自动装依赖、跑测试,告诉你这次改动有没有弄坏东西 |
| CD(持续交付/部署) | 测试通过后自动打包发布。交付是打包好等人点上线,部署是连点都不用点 |
| GitHub Actions | GitHub 自带的 CI/CD 服务,在你推代码时租一台临时虚拟机执行你写的步骤 |
| workflow | `.github/workflows/` 下的一个 YAML 文件,描述什么时候触发、跑哪些 job |
| job | workflow 里的一组步骤,在一台全新的虚拟机上执行;多个 job 之间用 `needs` 排先后 |
| step | job 里的一步,要么 `uses` 一个 action,要么 `run` 一条命令 |
| action | 别人打包好的可复用步骤,比如 `actions/checkout`,用 `@v7` 锁大版本,类似 npm 包 |
| runner | 执行 job 的那台机器。`ubuntu-latest` 是 GitHub 提供的,也可以用自己的机器(self-hosted) |
| 退出码 | 命令结束时返回的数字,0 表示成功,非 0 表示失败;CI 判断红绿就看它 |
| actionlint | 本地检查 workflow 文件的工具,相当于 workflow 专用的 ESLint |
| GHCR | GitHub Container Registry,`ghcr.io`,GitHub 自带的 Docker 镜像仓库 |
| Secrets(Actions) | 在仓库设置里存的加密变量,workflow 用 `${{ secrets.名字 }}` 读,日志里会被打码 |
| `GITHUB_TOKEN` | 每次运行自动生成的临时 token,权限由 `permissions` 决定,运行结束失效 |
| `${{ }}` 表达式 | Actions 的模板语法,执行前把里面的变量替换成值 |
| `workflow_dispatch` | 手动触发,Actions 页面会出现 Run workflow 按钮,可以带输入框 |
| `concurrency` | 让同一组的运行排队,避免两次部署同时改服务器 |

## 常见误区

**本地分支叫 master,workflow 写的是 main。** 推上去 Actions 页面什么都没有,也不报错。`git branch --show-current` 看一眼,用 `git branch -M main` 改名。反过来也一样,公司仓库主分支叫 master 或 develop 的,`branches:` 要跟着改。

**workflow 文件放错目录。** 必须是仓库根目录下的 `.github/workflows/`,少一个 s、写成 `.github/workflow/`,GitHub 完全无视它。

**在 pyproject.toml 里手写依赖,不更新 lock。** CI 里 `uv sync --locked` 会报 `The lockfile at uv.lock needs to be updated, but --locked was provided.`。用 `uv add` 加依赖,或者改完跑 `uv lock`,把 `uv.lock` 一起提交。

**在 workflow 里直接写密钥。** `.github/workflows/` 也是代码,会进 git 历史。密钥一律放 Secrets,用 `${{ secrets.X }}` 读;并且通过 `env:` 传给脚本,别直接拼进命令。

**用日常登录服务器的那把 SSH 私钥给 CI 用。** CI 的钥匙存在 GitHub 上,万一泄露,你自己的钥匙也得换。单独生成一把,服务器上只给它 deploy 用户的权限。

**镜像只打 `latest` 标签。** 出事时说不清线上跑的是哪一版,也没法精确回滚。用 `github.sha` 当标签。

**镜像名带大写字母。** GitHub 用户名或仓库名有大写的,`ghcr.io/${{ github.repository }}` 会被 Docker 以 `repository name must be lowercase` 拒绝。需要在 workflow 里先转小写,或者直接写死小写的名字。

**服务器拉不到 GHCR 的镜像。** 新推的镜像默认是私有的,服务器要先用一个只有 `read:packages` 权限的 token `docker login ghcr.io`,或者在包的设置里改成公开。

**把完整评测塞进每次推送。** 一次评测几百次模型调用,推得勤一天就是几十块钱和几十分钟。推送时只跑确定性测试和小冒烟集,完整评测定时跑。

## 学习资料

### 文档与文章

- [GitHub Actions 快速入门(中文)](https://docs.github.com/zh/actions/get-started/quickstart):官方中文版,跟着建第一个 workflow,15 分钟。
- [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax):`on`、`jobs`、`needs`、`permissions`、`concurrency` 的权威说明,当字典查,不用通读。
- [在 GitHub Actions 中使用机密(中文)](https://docs.github.com/zh/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets):Secrets 怎么建、怎么读、日志打码的规则,15 分钟。
- [uv · Using uv in GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/):uv 官方的 CI 写法,包括缓存和多 Python 版本,15 分钟。
- [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry):GHCR 的登录、权限和公开/私有设置,15 分钟。
- [GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions):免费额度以这里为准,5 分钟。
- 阮一峰《GitHub Actions 入门教程》(ruanyifeng.com,2019):中文里最常被推荐的一篇入门,概念讲得很清楚,写法有点旧(action 版本号都过时了),只看概念部分。这个站对命令行请求返回 403,需浏览器打开:https://www.ruanyifeng.com/blog/2019/09/getting-started-with-github-actions.html

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aT421y7Ar&autoplay=0&high_quality=1" title="GitHub Actions工作流自动化的入门核心" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · GitHub Actions工作流自动化的入门核心 · 16 分钟,8 万播放,动画讲 workflow、job、step、runner 的关系,和今天第一步对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11e411i7Xx&autoplay=0&high_quality=1" title="Github的王炸功能，但很少人知道怎么用？免费运行程序，流水线编译部署，天气推送 签到薅羊毛 领京豆 CI/CD持续集成持续部署" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · Github的王炸功能,但很少人知道怎么用? · 8 分钟,13 万播放。标题很花哨,内容是实打实的 Actions 演示,看他怎么在网页上看日志、配 Secrets 和定时触发。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/R8_veQiYBjI" title="GitHub Actions Tutorial - Basic Concepts and CI/CD Pipeline with Docker" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TechWorld with Nana · GitHub Actions Tutorial - Basic Concepts and CI/CD Pipeline with Docker · 英文,30 多分钟,后半段正好是「构建 Docker 镜像推到仓库」,和今天第五步一样的结构。</figcaption>
</figure>

### 书籍

- Jez Humble、David Farley《Continuous Delivery》(Addison-Wesley, 2010),中文版《持续交付:发布可靠软件的系统方法》(人民邮电出版社)。CI/CD 这套思想的源头,第 5 章「部署流水线」讲清楚了为什么要「一次构建、到处部署」和用版本号标记每个构建,今天用提交哈希打标签就是这个道理。挑第 5 章读,1 小时。
- Brent Laster《Learning GitHub Actions》(O'Reilly, 2023):专讲 Actions 的书,想系统学的话挑 workflow 语法和安全两章。英文原版。

### 开源项目与代码

- [rhysd/actionlint](https://github.com/rhysd/actionlint):今天用的检查工具,README 里有它能查的全部规则清单。
- [docker/build-push-action](https://github.com/docker/build-push-action):README 的 Examples 部分有带缓存、多平台构建的写法,以后镜像构建慢了来这里找。
- [actions/starter-workflows](https://github.com/actions/starter-workflows):GitHub 官方的 workflow 模板库,各种语言的 CI 写法都能参考。
- [nektos/act](https://github.com/nektos/act):在本地用 Docker 真正执行 workflow 的工具,比我们的模拟器完整得多。需要 Docker,本机没装所以今天没用。

## 自测

**1. CI 和 CD 分别管什么?用你熟悉的 Vercel 举例说明。**

<details><summary>答案</summary>

CI 管「这次改动有没有弄坏东西」:推代码或开 PR 后自动装依赖、跑测试,结果是红叉或绿勾。CD 管「把通过测试的版本发布出去」:自动打包、上线。Vercel 在你 push 之后 `npm ci && npm run build` 并部署,PR 时给预览地址,就是把 CI 和 CD 都替你做了;我们的 Agent 服务跑在自己的服务器上,所以要自己写 workflow。

</details>

**2. 一个 workflow 里有 test 和 deploy 两个 job,test 里装好的依赖,deploy 能直接用吗?为什么?**

<details><summary>答案</summary>

不能。每个 job 都在一台全新的虚拟机上运行,互相之间不共享文件。所以 deploy job 开头要重新 checkout 代码。需要在 job 之间传文件时,要用 artifact 上传下载,或者像我们这样通过镜像仓库传。

</details>

**3. `uv sync --locked` 在 CI 里失败了,报 `The lockfile at uv.lock needs to be updated`。原因是什么,怎么修?**

<details><summary>答案</summary>

`pyproject.toml` 里的依赖和 `uv.lock` 记录的对不上,通常是手动改了 pyproject 没跑 `uv lock`,或者改完没提交 lock 文件。本地执行 `uv lock`(或者以后用 `uv add` 加依赖),把更新后的 `uv.lock` 提交推送。不要为了让 CI 变绿把 `--locked` 去掉,那等于放弃了「CI 和服务器装的依赖与你本地测的一致」这个保证。

</details>

**4. 镜像标签为什么用 `github.sha` 而不是 `latest`?**

<details><summary>答案</summary>

`latest` 每次都会被覆盖,出问题时说不清线上跑的是哪一次提交,也没法精确退回某个版本。提交哈希每次都不同,标签和代码版本一一对应:看标签就知道是哪次提交,回滚时指定上一个好版本的哈希就行。

</details>

**5. 面试题:「你的 Agent 项目从提交代码到上线经过了哪些步骤?还缺什么?」**

<details><summary>答案</summary>

参考答法:推到 main 触发 GitHub Actions。test job 用 `uv sync --locked` 按 lock 文件装依赖,跑 pytest,测试里模型调用用假对象,保证确定;通过后 deploy job 构建镜像推到 GHCR,用提交哈希做标签,然后用一把专用的 SSH key 登服务器,`docker compose pull` 加 `up -d` 换掉 api 容器;部署用 concurrency 串行,另有一个手动触发的回滚 workflow,输入哈希就能退回。密钥都在 GitHub Secrets 里,workflow 只给最小权限。还缺:预发环境和冒烟测试、灰度或蓝绿发布、失败自动回滚、评测集接入门禁(现在只在合并前和每天定时跑)、基础设施用 Terraform 描述。

</details>

**6. 面试题:CI 里要不要跑调用真实大模型的评测?你怎么权衡?**

<details><summary>答案</summary>

要跑,但不是每次推送都跑全量。模型调用花钱、慢、结果不完全确定,全量评测每次几百次调用。我的做法分层:每次推送跑确定性的单元测试(模型用假对象)加一个 20 条左右的冒烟评测集,几分钱、一两分钟;合并到 main 前或每天定时跑完整评测集,结果和基线比,掉超过阈值就报警或拦截。API key 放在 Secrets,PR 来自外部 fork 时默认拿不到 secrets,所以外部贡献者的 PR 只跑离线测试。

</details>

## 明天预告

明天是 Day 428 · 自己跑开源模型:Ollama 和 vLLM 速览。到今天为止,流水线最后部署出去的服务,调的都是 DeepSeek 的云端 API。明天换个方向,把模型本身也放到自己的机器上:在笔记本上用 Ollama 跑一个小的通义千问,只改环境变量就让我们的代码改调本地模型,再用一个算式回答面试里常问的那句「你们为什么不自己部署模型」。
