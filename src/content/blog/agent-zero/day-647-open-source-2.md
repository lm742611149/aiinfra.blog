---
title: 'Day 647 · 开源影响力(二):自己的开源项目、技术写作和演讲'
description: '昨天发现给别人的项目提 PR 越来越难,今天把自己做过的东西变成别人能点开看的证据。用脚本检查一个准备开源的仓库(许可证、README、被跟踪的 .env、历史里的密钥),用规则检查博客标题,让模型把一条 ADR 扩写成文章大纲并核对它有没有编数字,最后给一个 20 分钟的技术分享算时间。'
pubDate: 2026-10-22
regime: none
tags: ['open-source', 'writing', 'public-speaking', 'career', 'python', 'agent-zero']
series: 'agent-zero'
day: 647
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 646](/blog/agent-zero/day-646-open-source-1/) 先数了 JD:国内真在说开源贡献的大约 17%,几乎都在加分项里,美团那条甚至写了有突出开源作品「年限可适当放宽」。然后用 GitHub API 看了四个 Agent 框架,最近 50 个关闭的 PR 里一个首次贡献者的都没合并;读了贡献指南才知道原因:OpenAI Agents SDK 不收外部 PR,MCP SDK 要求关联已指派的 issue。最后在本机用两个假仓库走完 fork 流程,还看到模型替你写 PR 描述时会编出一个不存在的 `__init__.py`。

给别人的项目贡献,门在别人手里。今天讲另外两样门在你自己手里的东西:把自己的项目开源出去,以及写文章、做分享。昨天 G-Research 那条 JD 把「开源贡献、技术写作、会议演讲」放在一句话里,今天把后两样补上。

## 今天要解决的问题

学完今天,你应该能做到:

1. 开源一个自己的项目之前,用 `release_check.py` 查出缺许可证、缺 README 小节、`.env` 被跟踪、代码里有密钥这几类问题,并且知道删掉文件之后**历史里的密钥还在**。
2. 写出别人能搜到的技术博客标题,知道哪几类文章最值得写。
3. 让模型把一条 ADR 扩写成文章大纲,并用脚本核对大纲里有没有 ADR 之外的数字。
4. 给一个 20 分钟的技术分享排结构,用字数估算每一段的时长。

预计用时:2.5 小时。脚本 1.5 小时,剩下的时间写你自己的第一篇文章大纲。前置:[Day 56](/blog/agent-zero/day-056-git-1/)(git 和「先查密钥再 add」)、[Day 491](/blog/agent-zero/day-491-readme-arch/)(README 和架构图)、[Day 492](/blog/agent-zero/day-492-video-blog/)(演示视频和技术博客)、[Day 640](/blog/agent-zero/day-640-design-docs-1/)(ADR 和数字标签)、[Day 641](/blog/agent-zero/day-641-build-vs-buy/)(缓存命中实测)、[Day 646](/blog/agent-zero/day-646-open-source-1/)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把开源前检查的五条和分享的结构默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 自己的项目:开源什么

这门课你手里已经有不少能开源的东西,不需要再另起炉灶:

- **SupportPilot 或 AgentOps 的精简版。** 去掉业务数据,保留架构、评测框架和部署脚本。[Day 639](/blog/agent-zero/day-639-agentops-showcase/) 已经把 AgentOps 包装过一次,今天要补的是开源这一步特有的检查。
- **一个小而专的 MCP server。** 比如把 CloudLedger 的客户、订阅、发票查询包成 MCP。小项目更容易被人真正用起来,也更容易讲清楚。
- **一个评测工具或数据集。** 第十部分的 Wilson 区间、配对比较那几个脚本,整理成一个小库;或者你构造的评测集的方法和一部分数据。社区里又一个 Agent 框架没人缺,好用的评测小工具反而少。

选哪个,看你想让面试官看到什么。想证明能做系统,开 AgentOps 精简版;想证明能做出别人会用的东西,开 MCP server;想往评测方向深挖,开评测工具。

我的建议是不要追 star。昨天酷加那条 JD 原话是「看解决问题的品味,不看 star 数」。一个有十个真实用户、issue 里有人讨论的小工具,在面试里比一个三千 star 没人用的项目有说服力得多,因为面试官点进 issue 区就能看到你怎么回应用户。

## 开源前的检查:先演示一次会出什么事

开源和推到私有仓库不同,一旦公开,任何人都能克隆,包括你提交历史里的每一个版本。下面先故意做一个「准备不充分」的仓库,看会漏出什么。还是在 [Day 646](/blog/agent-zero/day-646-open-source-1/) 建的 `~/oss-practice/` 下面:

```bash
mkdir -p ~/oss-practice/cloudledger-mcp && cd ~/oss-practice/cloudledger-mcp
git init -q && git checkout -q -b main
printf '# cloudledger-mcp\n\n把 CloudLedger 的客户、订阅、发票查询包成 MCP server。\n' > README.md
printf 'LLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=sk-FAKE0000000000000000000000000000\n' > .env
printf 'import os\n\nAPI_KEY = os.environ.get("LLM_API_KEY", "sk-FAKE1111111111111111111111111111")\n' > config.py
printf 'from mcp.server.fastmcp import FastMCP\n\nmcp = FastMCP("cloudledger")\n' > server.py
git add . && git commit -qm "init" && git ls-files
```

<div class="line-notes">

- `mkdir -p ~/oss-practice/cloudledger-mcp && cd ~/oss-practice/cloudledger-mcp` 一个假的 MCP server 项目,只为演示,里面的代码跑不起来也没关系。
- `printf 'LLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=sk-FAKE0000000000000000000000000000\n' > .env` `.env` 里放一个**假的** key。`sk-FAKE` 后面跟 28 个 0,格式像真 key,但不是。演示泄露永远用假数据,千万别拿你真的 `.env` 来试。
- `API_KEY = os.environ.get("LLM_API_KEY", "sk-FAKE1111111111111111111111111111")` 第二个坑:`get` 的第二个参数是默认值,很多人图省事把 key 写在这里,「本地没配环境变量也能跑」。这一行进了仓库,key 就公开了。
- `git add . && git commit -qm "init" && git ls-files` `git add .` 把当前目录所有文件都加进去,因为还没有 `.gitignore`,`.env` 也被加了。`git ls-files` 列出 git 正在跟踪的文件。

</div>

```text
.env
README.md
config.py
server.py
```

四个文件全被跟踪,`.env` 赫然在列。这个错误我见过太多次:推到 GitHub 几分钟之内,扫描公开仓库找 key 的机器人就会发现它。GitHub 自己也有密钥扫描,会给你发邮件,但那时候 key 已经暴露了。

写一个开源前的检查器 `part10/release_check.py`。它和 Day 646 的 `pr_lint.py` 是同一种思路:把容易忘的事情变成规则。不同的是这次要读的是 git 跟踪的文件列表,所以要在 Python 里调用 git 命令。

```python
# agent-zero-lab/part10/release_check.py
import re
import subprocess
import sys
from pathlib import Path

SECRET = re.compile(r"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----")
README_NEEDS = ["快速开始", "架构", "评测"]
MAX_BYTES = 1_000_000

def tracked_files(repo: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=repo, capture_output=True, text=True, check=True)
    return out.stdout.splitlines()

def check(repo: Path) -> list[str]:
    files = tracked_files(repo)
    problems: list[str] = []
    if not any(f.upper().startswith("LICENSE") for f in files):
        problems.append("没有 LICENSE 文件,别人在法律上不能用你的代码")
    if "README.md" not in files:
        problems.append("没有 README.md")
    else:
        readme = (repo / "README.md").read_text(encoding="utf-8")
        for word in README_NEEDS:
            if word not in readme:
                problems.append(f"README 缺少「{word}」一节")
    for f in files:
        if Path(f).name == ".env":
            problems.append(f"{f} 被 git 跟踪了,密钥会跟着公开")
        path = repo / f
        if path.stat().st_size > MAX_BYTES:
            problems.append(f"{f} 超过 1 MB,数据文件别放进仓库")
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in SECRET.finditer(text):
            problems.append(f"{f} 里有疑似密钥:{m.group()[:8]}…")
    return problems

if __name__ == "__main__":
    repo = Path(sys.argv[1])
    found = check(repo)
    for p in found:
        print("-", p)
    print(f"{repo.name}: {len(found)} 个问题")
    sys.exit(1 if found else 0)
```

<div class="line-notes">

- `SECRET = re.compile(r"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----")` 三种常见密钥的样子:`sk-` 开头的模型 API key(OpenAI、DeepSeek 都是这个格式)、`AKIA` 开头的 AWS 访问密钥、PEM 格式的私钥文件头。`{20,}` 是「至少 20 个」。这只是最小版本,真实项目用 gitleaks 这类专门工具,它有几百条规则。
- `README_NEEDS = ["快速开始", "架构", "评测"]` [Day 491](/blog/agent-zero/day-491-readme-arch/) 讲过面试官打开 README 的五分钟要看到什么。这里只查最关键的三节。用中文小节名是因为这是中文项目;做英文项目就换成 `Quickstart`、`Architecture`、`Evaluation`。
- `out = subprocess.run(["git", "ls-files"], cwd=repo, capture_output=True, text=True, check=True)` 在 Python 里跑一条命令,≈ Node 的 `execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })`。参数用列表传,不拼字符串,避免路径里有空格时出错。`capture_output=True` 把输出收进来而不是打印到屏幕;`text=True` 让输出是字符串而不是字节;`check=True` 命令失败(比如目录不是 git 仓库)就抛异常。
- `return out.stdout.splitlines()` 一行一个文件名,实跑得到 `['.env', 'README.md', 'config.py', 'server.py']`。
- `if not any(f.upper().startswith("LICENSE") for f in files):` 许可证文件可能叫 `LICENSE`、`LICENSE.md`、`License.txt`,统一转大写再比。`any(...)` ≈ JS 的 `files.some(...)`。
- `readme = (repo / "README.md").read_text(encoding="utf-8")` `Path` 对象可以用 `/` 拼路径,≈ Node 的 `path.join(repo, "README.md")`。
- `if Path(f).name == ".env":` 只看文件名,子目录里的 `.env` 也算。`.env.example` 不会命中,它本来就该进仓库。
- `if path.stat().st_size > MAX_BYTES:` 文件大小,单位字节,≈ `fs.statSync(path).size`。大文件不读内容直接跳过,`continue` ≈ JS 循环里的 `continue`。
- `text = path.read_text(encoding="utf-8", errors="ignore")` `errors="ignore"` 遇到不是 UTF-8 的字节(图片之类)直接跳过,不报错。
- `problems.append(f"{f} 里有疑似密钥:{m.group()[:8]}…")` 只打印前 8 个字符。**检查器自己的输出也不能把完整的 key 打出来**,输出可能进 CI 日志。

</div>

在 `agent-zero-lab/` 根目录跑,参数是要检查的仓库路径:

```bash
uv run python -m part10.release_check ~/oss-practice/cloudledger-mcp
```

```text
- 没有 LICENSE 文件,别人在法律上不能用你的代码
- README 缺少「快速开始」一节
- README 缺少「架构」一节
- README 缺少「评测」一节
- .env 被 git 跟踪了,密钥会跟着公开
- .env 里有疑似密钥:sk-FAKE0…
- config.py 里有疑似密钥:sk-FAKE1…
cloudledger-mcp: 7 个问题
```

七个问题。第一条要单独说一下:**没有许可证的代码,默认版权归作者所有,别人在法律上不能复制、修改、再发布。** 你把代码放到 GitHub 上公开,不等于开源。很多人以为「公开了就是开源」,公司的法务不这么看,有些公司的工程师根本不被允许使用没有许可证的代码。

## 修好它:许可证、README、.gitignore

**许可证怎么选。** [choosealicense.com](https://choosealicense.com/) 三分钟能选完。个人项目一般就两个选择:**MIT** 最宽松,别人随便用,只要保留你的版权声明;**Apache-2.0** 也很宽松,多了一条专利授权,大公司的法务更喜欢它。MCP Python SDK 和 LangGraph 用的都是 MIT。想要「别人改了也必须开源」就选 GPL 系列,但这会让很多公司不敢用。我自己的小工具一律 MIT。

许可证全文不要自己写,也不要从别的项目复制(里面有别人的名字)。GitHub 有一个公开接口直接给模板,网页上新建文件时输入 `LICENSE` 也会弹出选择器。命令行版:

```bash
cd ~/oss-practice/cloudledger-mcp
git rm -q --cached .env
printf '.env\n.venv/\n__pycache__/\n' > .gitignore
printf 'import os\n\nAPI_KEY = os.environ["LLM_API_KEY"]\n' > config.py
curl -s https://api.github.com/licenses/mit | python3 -c "import json,sys;print(json.load(sys.stdin)['body'])" | sed 's/\[year\]/2026/; s/\[fullname\]/Your Name/' > LICENSE
head -3 LICENSE
printf 'LLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=\n' > .env.example
```

<div class="line-notes">

- `git rm -q --cached .env` `--cached` 只是让 git 不再跟踪这个文件,硬盘上的 `.env` 还在。不加 `--cached` 会连文件一起删掉。
- `printf '.env\n.venv/\n__pycache__/\n' > .gitignore` 以后 `git add .` 就不会再把它们加进来。`.venv` ≈ `node_modules`,`__pycache__` 是 Python 的编译缓存。
- `API_KEY = os.environ["LLM_API_KEY"]` 去掉默认值,改成方括号取值:没配环境变量就直接报 `KeyError`。宁可启动失败,也不要在代码里留一个「兜底的 key」。
- `curl -s https://api.github.com/licenses/mit` GitHub 的许可证接口,返回 JSON,`body` 字段是全文,里面有 `[year]` 和 `[fullname]` 两个占位符。这个接口不需要登录,占 60 次限额里的 1 次。同一行后半段的 `sed` 把占位符换成年份和你的名字,方括号在 sed 里有特殊含义,所以要加反斜杠转义。
- `printf 'LLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=\n' > .env.example` 给使用者一份模板,告诉他要配哪些变量,值留空。这个文件要进仓库。

</div>

```text
MIT License

Copyright (c) 2026 Your Name
```

README 补上三节。英文项目照这个结构写英文:

```markdown
# cloudledger-mcp

把 CloudLedger 的客户、订阅、发票查询包成 MCP server,给客服 Agent 用。

## 快速开始

    uv sync
    cp .env.example .env   # 填自己的 key
    uv run python server.py

## 架构

Agent → MCP(stdio)→ server.py → SQLite 里的示例数据。

## 评测

20 条查询用例,见 evals/。
```

这是演示用的骨架,真实项目的「架构」放一张图,「评测」放一张结果表,写法见 [Day 491](/blog/agent-zero/day-491-readme-arch/)。提交后再查一次:

```bash
git add . && git commit -qm "chore: prepare for open source" && git ls-files
cd ~/agent-zero-lab && uv run python -m part10.release_check ~/oss-practice/cloudledger-mcp
```

```text
.env.example
.gitignore
LICENSE
README.md
config.py
server.py
cloudledger-mcp: 0 个问题
```

0 个问题,可以推了吗?**还不行。** 检查器只看了当前版本的文件,可 git 存的是全部历史。用 `-S` 在历史里搜一下 `sk-FAKE` 这个字符串出现和消失的提交:

```bash
cd ~/oss-practice/cloudledger-mcp
git log -p --all -S 'sk-FAKE' --oneline | grep -E '^[0-9a-f]{7}|sk-FAKE'
```

```text
ac71459 chore: prepare for open source
-LLM_API_KEY=sk-FAKE0000000000000000000000000000
-API_KEY = os.environ.get("LLM_API_KEY", "sk-FAKE1111111111111111111111111111")
bcc34f9 init
+LLM_API_KEY=sk-FAKE0000000000000000000000000000
+API_KEY = os.environ.get("LLM_API_KEY", "sk-FAKE1111111111111111111111111111")
```

`+` 是加进来的行,`-` 是删掉的行。两个 key 在第一个提交 `bcc34f9` 里加进来,在第二个提交里删掉,但第一个提交还在。你把这个仓库推到 GitHub,任何人 `git clone` 下来,`git show bcc34f9` 就能看到完整的 key。你的提交号会和我的不一样,这很正常。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="删掉文件不等于删掉历史:密钥仍然留在旧提交里">
<rect x="30" y="40" width="170" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">提交 bcc34f9 init</text>
<text x="115" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+ .env(有 key)</text>
<text x="115" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+ config.py(有 key)</text>
<rect x="240" y="40" width="170" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="325" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">提交 ac71459</text>
<text x="325" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">- .env</text>
<text x="325" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">- key,+ LICENSE</text>
<path d="M 200 75 L 240 75" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="450" y="40" width="160" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">release_check</text>
<text x="530" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只看当前文件</text>
<text x="530" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ 0 个问题</text>
<path d="M 410 75 L 450 75" fill="none" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
<path d="M 115 110 L 115 160 L 470 160" fill="none" stroke="var(--compute)" stroke-width="1.5"/>
<text x="290" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">git clone 之后 git show bcc34f9 照样能看到</text>
<text x="320" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">先作废 key,再决定怎么处理历史</text>
</svg>
<figcaption>删掉文件只是在历史上加了一个新提交,旧提交原封不动。检查当前文件得到 0 个问题,不代表仓库能公开。</figcaption>
</figure>

怎么办?顺序很重要:

1. **先作废这个 key。** 到 DeepSeek(或者你用的平台)的控制台删掉它,生成一个新的。只要 key 进过任何一个可能公开的地方,就当它已经泄露了,不要侥幸。
2. **再处理历史。** 个人小项目最简单的办法:新建一个目录,把当前文件(不含 `.git`)复制过去,`git init` 重新提交,只推这个干净的新仓库。代价是丢掉历史,对一个准备第一次公开的个人项目通常没关系。要保留历史就用 `git filter-repo` 改写,GitHub 文档有一篇专门讲怎么从仓库里删除敏感数据,学习资料里有链接。
3. **以后提交前就查。** [Day 56](/blog/agent-zero/day-056-git-1/) 讲过「先查密钥再 add」,练习 1 会把历史扫描加进检查器。

其他几个细节:写一份哪怕只有几行的 `CONTRIBUTING.md`,告诉别人怎么跑测试、你接不接受 PR,昨天你已经看到维护者的规矩写清楚有多重要;打 tag 发一个 release(`git tag v0.1.0 && git push origin v0.1.0`),别人才能锁定版本;回复每一个 issue,哪怕只是「收到,这周看」。

## 技术写作:写什么

写作是公开影响力里投入产出比最高的一种:能被搜到,能被转发,写的过程本身逼你把事情想清楚。[Day 492](/blog/agent-zero/day-492-video-blog/) 讲过给作品配一篇博客,今天从资深的角度再往前走一步。

最值得写的三类:

1. **踩坑和根因。** 比如「LangGraph 的 interrupt 不配 checkpointer,第一次调用不报错,恢复时才抛异常」。别人搜报错信息就能搜到你,这类文章的寿命比你想的长。
2. **带数据的对比和复盘。** 「我把 SupportPilot 的路由从大模型换成小模型,成本降了多少、准确率掉了多少、哪些类别掉得最多」。有数字的文章比观点文章可信得多,[Day 645](/blog/agent-zero/day-645-influence/) 讲的「每个数字标来源」在这里一样适用。
3. **设计决策。** 把你的 ADR 扩写成文章:当时的约束、考虑过的方案、为什么这么选、事后看对不对。资深面试官最爱看这一类,因为它直接展示判断力。

Julia Evans 写过一篇《How do you write blog posts?》,讲她怎么写技术博客,几条很实用:写你刚学会的东西,因为你还记得哪里难;一篇只讲一件事;用具体例子而不是抽象道理。swyx 的《Learn in Public》讲的是另一面:把学习过程公开,不用等成为专家才写。Simon Willison 的博客是个很好的榜样,大量几百字的 TIL(today I learned,今天学到的一个小知识)加偶尔的长文,常年积累下来,成了 LLM 领域很多工程师每天都看的个人博客。他还专门写过一篇《What to blog about》,建议就两类:TIL 和你做的项目。

**发在哪。** 个人站是根,平台是分发渠道。中文读者:个人站加掘金或知乎同步,公众号适合有固定读者之后。英文读者(海外远程的目标):个人站加 dev.to 或 Medium,写完在 Hacker News、Reddit 相关板块、X 上分享。不要只发在平台上,平台会改规则、会限流、会关停,文章没了你的证据也没了。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1334y1q72q&autoplay=0&high_quality=1" title="程序员写技术博客新手指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术胖 · 程序员写技术博客新手指南 | 程序员为什么要写博客?| 我写了四年博客收获了什么 · 9 分钟。一位写了四年博客的 UP 主讲为什么写、写什么、收获了什么,适合开写之前给自己打气。</figcaption>
</figure>

## 标题:让需要的人搜到你

一篇文章能不能被找到,一大半看标题。「关于 Agent 的一些思考」没人点,也没人搜得到;「LangGraph interrupt 不配 checkpointer,恢复时才报错」会被踩到同一个坑的人搜到。好标题有三个特征:有具体的技术名词(搜索用的就是这些词),有结果或者数字(读者一眼知道值不值得点),长度适中。

把这几条写成一个检查器 `part10/title_check.py`。规则是我自己的经验,不是标准答案:

```python
# agent-zero-lab/part10/title_check.py
import re

VAGUE = ["一些思考", "浅谈", "聊聊", "探索", "心得", "总结", "初探"]
TECH = re.compile(r"[A-Za-z][A-Za-z0-9.+-]{1,}")
NUMBER = re.compile(r"\d")

def title_problems(title: str) -> list[str]:
    problems = [f"空话「{w}」" for w in VAGUE if w in title]
    if not TECH.search(title):
        problems.append("没有具体的技术名词,别人搜不到")
    if not NUMBER.search(title):
        problems.append("没有数字,看不出结果")
    if not 12 <= len(title) <= 45:
        problems.append(f"长度 {len(title)},控制在 12 到 45 个字符")
    return problems

if __name__ == "__main__":
    titles = [
        "关于 Agent 的一些思考",
        "浅谈 RAG",
        "LangGraph interrupt 不配 checkpointer,恢复时才报错",
        "客服知识库混合检索 vs 纯向量:recall@5 从 0.81 到 0.92",
        "Agent 严重错误率 0.4% 对 1.2%,为什么不能说好三倍",
        "我是怎么用 Claude Code、Cursor、Codex 三个工具在一个周末里把一个客服 Agent 从零做到上线的完整记录",
    ]
    for t in titles:
        p = title_problems(t)
        print(("OK " if not p else "改 ") + t)
        for x in p:
            print("     -", x)
```

<div class="line-notes">

- `VAGUE = ["一些思考", "浅谈", "聊聊", "探索", "心得", "总结", "初探"]` 这些词的问题不是不礼貌,是没有信息量:它们告诉读者「这篇没有结论」。
- `TECH = re.compile(r"[A-Za-z][A-Za-z0-9.+-]{1,}")` 粗略地用「至少两个字符的英文单词」代表技术名词,因为 Agent 领域的技术名词几乎都是英文:LangGraph、RAG、MCP、checkpointer。`[A-Za-z0-9.+-]` 允许 `recall@5` 前半截、`1.x`、`C++` 这类写法。
- `NUMBER = re.compile(r"\d")` 只要有一个数字就算有结果。很粗,但能逼你想一想「这篇文章的结果是什么」。
- `problems = [f"空话「{w}」" for w in VAGUE if w in title]` `w in title` 对字符串是子串判断,≈ JS 的 `title.includes(w)`。
- `if not 12 <= len(title) <= 45:` Python 可以连着写比较,`12 <= x <= 45` 就是「在 12 和 45 之间」,JS 要写成 `x >= 12 && x <= 45`。`len` 按字符数算,一个汉字算 1。

</div>

```bash
uv run python -m part10.title_check
```

```text
改 关于 Agent 的一些思考
     - 空话「一些思考」
     - 没有数字,看不出结果
改 浅谈 RAG
     - 空话「浅谈」
     - 没有数字,看不出结果
     - 长度 6,控制在 12 到 45 个字符
改 LangGraph interrupt 不配 checkpointer,恢复时才报错
     - 没有数字,看不出结果
OK 客服知识库混合检索 vs 纯向量:recall@5 从 0.81 到 0.92
OK Agent 严重错误率 0.4% 对 1.2%,为什么不能说好三倍
改 我是怎么用 Claude Code、Cursor、Codex 三个工具在一个周末里把一个客服 Agent 从零做到上线的完整记录
     - 没有数字,看不出结果
     - 长度 64,控制在 12 到 45 个字符
```

第三条是个好标题,却被「没有数字」拦住了。这正好说明规则只是提醒:踩坑类文章的「结果」就是那个报错现象,不一定要有数字。检查器帮你发现问题,最后由你判断要不要改。练习 2 里给它加上版本号「1.x」,既过了检查,也更有用,因为框架换大版本时行为可能就变了。

最后一条又长又没有结果,典型的「流水账」标题。它真正想说的大概是「一个周末做完客服 Agent,三个工具各帮了哪些忙」,把结果放进标题,过程放进正文。

## 从 ADR 到文章大纲:让模型起草,自己核数字

设计决策类文章最省力的写法,是从你已经写好的 ADR 出发。[Day 640](/blog/agent-zero/day-640-design-docs-1/) 用 `adr.py` 建过三条 ADR,当时只有骨架。今天把 `0002-缓存只做精确匹配.md` 的正文补全,里面的数字按 Day 640 的规矩标了「实测」或「假设」:

```markdown
# ADR-0002:缓存只做精确匹配

- 状态:已接受(2026-10-22)

## 背景
AgentOps 网关要给 15 个团队的模型调用加一层缓存,有人提议做语义缓存(意思相近的问题返回同一个答案)。
DeepSeek 的上下文缓存已经按前缀自动生效:Day 641 实测同一段 488 token 的输入,第二次命中 256 token,单次费用从 ¥0.00147 降到 ¥0.00112(实测)。
客服场景里,两个问题字面几乎一样、账号不同,答案就不同,比如「我这个月的发票为什么多扣了 30 元」。

## 决定
网关只做精确匹配缓存:模型、消息、工具定义、温度完全一样才返回缓存结果;温度大于 0 的请求不缓存。不做语义缓存。

## 后果
好的:不会把 A 客户的答案返回给 B 客户;实现简单,请求内容的哈希做键。
坏的:命中率低,预计精确命中率在 5% 以下(假设,上线后实测)。
需要重新评估的条件:出现大量和账号无关的 FAQ 类调用,并且抽检 2000 条语义缓存结果没有一条答错账号(假设的门槛)。
```

488、256、¥0.00147、¥0.00112 这几个数是 Day 641 `model_cost.py` 真跑出来的;15 个团队是 Day 642 真题一的设定;5% 和 2000 条是假设,2000 来自 Day 645 练习 2 算出的抽检量级。

然后写 `part10/adr_outline.py`:把 ADR 交给模型扩写成五节的文章大纲,再用两道检查把关:标题过 `title_check`,大纲里的每个数字都必须在 ADR 里出现过。第二道检查直接来自昨天的教训,模型会编东西,写文章时它最爱编的就是数字。

```python
# agent-zero-lab/part10/adr_outline.py
import json
import re
import sys
from pathlib import Path

from common.llm import LLMClient
from part10.title_check import title_problems

ASK = """把下面这条 ADR 扩写成一篇中文技术博客的大纲。
要求:标题写清场景和结果;5 节,顺序是 问题、约束、方案对比、数据、事后看;
每节给一句要点和这一节要用到的数字。只能用 ADR 里出现过的数字,ADR 里没有的写「待补」。
只输出 JSON:{"title": "...", "sections": [{"heading": "...", "point": "...", "numbers": ["..."]}]}"""
NUM = re.compile(r"\d+(?:\.\d+)?")

def invented(outline: dict, source: str) -> list[str]:
    allowed = set(NUM.findall(source))
    text = json.dumps(outline, ensure_ascii=False)
    return sorted({n for n in NUM.findall(text) if n not in allowed})

if __name__ == "__main__":
    adr = Path(sys.argv[1]).read_text(encoding="utf-8")
    llm = LLMClient()
    r = llm.chat([{"role": "system", "content": ASK}, {"role": "user", "content": adr}],
                 temperature=0, response_format={"type": "json_object"})
    outline = json.loads(r.content)
    print("标题:", outline["title"])
    for i, s in enumerate(outline["sections"], start=1):
        print(f"{i}. {s['heading']}:{s['point']}  数字 {s['numbers']}")
    print("标题检查:", title_problems(outline["title"]) or "通过")
    print("ADR 里没有的数字:", invented(outline, adr) or "无")
    Path("part10/samples/outline.json").write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(llm.ledger)
```

<div class="line-notes">

- `ASK = """把下面这条 ADR 扩写成一篇中文技术博客的大纲。` 五节的顺序就是上面说的「设计决策」类文章结构:问题、约束、方案对比、数据、事后看。
- `每节给一句要点和这一节要用到的数字。只能用 ADR 里出现过的数字,ADR 里没有的写「待补」。` 提示词里明确要求不许编数字。光写这一句不够,所以下面还要用代码核对。
- `NUM = re.compile(r"\d+(?:\.\d+)?")` 匹配整数和小数,`0.00147` 会整个匹配出来。`(?:...)` 是非捕获组,让 `findall` 返回完整的数而不是括号里那一段。
- `def invented(outline: dict, source: str) -> list[str]:` 找出大纲里有、ADR 里没有的数字。
- `allowed = set(NUM.findall(source))` ADR 里所有出现过的数字,实跑包括 `0002`、`15`、`641`、`488`、`256`、`0.00147` 等。注意它是按字符串比较的,`5` 和 `5.0` 算不同。
- `text = json.dumps(outline, ensure_ascii=False)` 把整个大纲转回字符串,一次性扫描标题、要点和数字列表。`ensure_ascii=False` 让中文保持原样,≈ JS 的 `JSON.stringify`(JS 默认就不转义中文)。
- `return sorted({n for n in NUM.findall(text) if n not in allowed})` 集合推导式去重,再排序,方便阅读。
- `temperature=0, response_format={"type": "json_object"})` 和 Day 645 的 `skeptic.py` 一样,要求模型只输出 JSON。
- `for i, s in enumerate(outline["sections"], start=1):` `enumerate` 同时给出序号和元素,`start=1` 让序号从 1 开始,≈ JS 的 `sections.forEach((s, i) => ...)` 再加 1。

</div>

```bash
uv run python -m part10.adr_outline part10/samples/adr/0002-缓存只做精确匹配.md
```

```text
标题: AgentOps 网关缓存决策：放弃语义缓存，只做精确匹配，避免跨账号答案泄露
1. 问题：语义缓存提议与跨账号答案风险:有人提议做语义缓存以提升命中率，但客服场景中字面相似的问题因账号不同答案不同，存在泄露风险。  数字 ['15 个团队', '30 元']
2. 约束：DeepSeek 前缀缓存已生效与客服场景的账号敏感性:DeepSeek 上下文缓存按前缀自动生效，且客服问题涉及账号差异，语义缓存可能返回错误答案。  数字 ['488 token', '256 token', '¥0.00147', '¥0.00112']
3. 方案对比：精确匹配缓存 vs 语义缓存:决定只做精确匹配缓存（模型、消息、工具定义、温度完全一致才缓存，温度大于 0 不缓存），不做语义缓存。  数字 ['待补']
4. 数据：精确匹配的预期命中率与成本节省:精确匹配缓存命中率预计低于 5%（假设，上线后实测），但能确保不会把 A 客户的答案返回给 B 客户。  数字 ['5% 以下']
5. 事后看：重新评估的条件与假设门槛:若出现大量与账号无关的 FAQ 类调用，且抽检 2000 条语义缓存结果无一答错账号，则需重新评估。  数字 ['2000 条']
标题检查: ['没有数字,看不出结果']
ADR 里没有的数字: 无
1 次调用 | 输入 405 / 输出 391 tokens | 约 ¥0.0039
```

花费 ¥0.0039,算式 `(405 × 2 + 391 × 8) / 1,000,000`。模型输出里用的是全角标点,这是它自己的习惯,不影响。

这次模型守规矩了,没编数字。但大纲本身暴露了两个问题,比任何检查器都有价值:

**「数据」那一节几乎是空的。** 它唯一的数字「5% 以下」是假设。一篇设计决策文章,最该有分量的那一节没有实测数据。这不是模型的错,是 ADR 本来就没有。所以这个大纲真正告诉你的是:**写这篇文章之前,先去把精确缓存上线跑两周,拿到真实命中率**。很多时候写作的价值就在这里,它逼你发现自己还不知道什么。

**标题又长又没有结果。** 「避免跨账号答案泄露」是动机,不是结果。等有了数据,标题可以是「网关缓存只做精确匹配:命中率 X%,省了多少钱,为什么不做语义缓存」。

所以模型适合干的是搭架子:把 ADR 的几段拆成文章结构、提醒你哪一节缺东西。正文要你自己写,数字要你自己跑出来。练习 3 会喂给 `invented()` 一份编了数字的大纲,看它能不能抓住。

## 演讲:20 分钟怎么排

分享从小场合开始:组内分享 → 公司内部技术沙龙 → 本地 meetup → 行业会议。每一级都给下一级攒素材和胆量。一个 15 到 20 分钟的技术分享,我常用的结构是:

- **开场 2 分钟:一个具体的问题。** 「上个月评审会上有人提议给网关加语义缓存,我差点就同意了」比「今天讲讲缓存设计」抓人得多。
- **中间 12 分钟:你怎么分析和决定的。** 讲两三个关键判断,每个配一张图或一个数。不要放大段代码,台下没人看得清。
- **结尾 3 分钟:能带走的东西。** 一条结论,或者一个检查清单。
- **问答 3 分钟。**

它和文章大纲几乎是同一个结构,所以上一节的大纲直接就是讲稿的骨架。

讲稿写多少字?这件事很容易估错。我把上面那篇的讲稿起了个头,存成 `part10/samples/talk.md`,每个二级标题后面写上这一段的分钟预算:

```markdown
# 网关缓存为什么不做语义缓存

## 开场 2
上个月有人在评审会上提议,给 AgentOps 网关加一层语义缓存。理由很好听:意思相近的问题直接返回缓存的答案,省钱又快。我当时差一点就同意了。后来我拿客服的真实问题试了一下,发现两个人问「我这个月的发票为什么多扣了 30 元」,字面几乎一样,答案完全不同,因为他们是两个账号。语义缓存会把 A 客户的答案返回给 B 客户。今天这 20 分钟,我讲三件事:我们为什么最后只做精确匹配,DeepSeek 自带的前缀缓存已经帮我们省了多少,以及什么情况下我会推翻这个决定。

## 约束 3
网关后面挂着 15 个团队。DeepSeek 的上下文缓存按前缀自动生效,我们实测同一段 488 token 的输入,第二次命中 256 token,单次费用从 0.00147 元降到 0.00112 元。也就是说,便宜的那部分缓存,供应商已经替我们做了。

## 方案对比 5
精确匹配:模型、消息、工具定义、温度完全一样才命中。语义缓存:用向量相似度判断两个问题是不是同一个意思。精确匹配的问题是命中率低,我们估计在 5% 以下,这是假设,上线后要实测。语义缓存的问题是它会答错账号,而且答错的时候没有任何报错,用户只会觉得系统胡说八道。我们讨论过加一层账号过滤,只在同一个账号内做语义缓存,但同一个账号的重复问题本来就少,做了也省不了多少。还讨论过只对 FAQ 类问题开语义缓存,问题是 FAQ 和账号问题的边界很难划,一个分类器分错一次,就是一次泄露。我们还考虑过按租户开关,让每个团队自己决定,但这等于把风险转嫁给了不懂缓存的人。最后的判断是:省下的钱是可以算出来的小数目,出错的代价是一次客户投诉甚至合规事件,两者不在一个量级。

## 数据 4
待补:上线两周后的精确命中率,和按命中率算出的省钱金额。

## 事后看 3
如果出现大量和账号无关的 FAQ 类调用,并且抽检 2000 条语义缓存结果没有一条答错账号,我会重新评估。

## 问答 3
```

写一个小脚本 `part10/talk_time.py`,按字数估算每段要讲多久:

```python
# agent-zero-lab/part10/talk_time.py
import re
import sys
from pathlib import Path

RATE = 220  # 每分钟讲多少字(假设,练习 4 教你测自己的)
HEAD = re.compile(r"^## (.+?) (\d+)$")
CJK = re.compile(r"[一-鿿]")

def sections(text: str) -> list[tuple[str, int, str]]:
    out: list[tuple[str, int, str]] = []
    for line in text.splitlines():
        m = HEAD.match(line)
        if m:
            out.append((m.group(1), int(m.group(2)), ""))
        elif out:
            name, budget, body = out[-1]
            out[-1] = (name, budget, body + line)
    return out

if __name__ == "__main__":
    total_budget = 0
    for name, budget, body in sections(Path(sys.argv[1]).read_text(encoding="utf-8")):
        chars = len(CJK.findall(body))
        need = chars / RATE
        total_budget += budget
        if chars == 0:
            flag = "(没写稿,临场讲)"
        elif need > budget * 1.2:
            flag = "超时,删一半"
        elif "待补" in body:
            flag = "数据还没有"
        elif need < budget * 0.5:
            flag = "稿子不到一半,补内容或缩预算"
        else:
            flag = ""
        print(f"{name:<6} 预算 {budget:>2} 分钟  稿子 {chars:>4} 字 ≈ {need:4.1f} 分钟  {flag}")
    print(f"总预算 {total_budget} 分钟")
```

<div class="line-notes">

- `RATE = 220  # 每分钟讲多少字(假设,练习 4 教你测自己的)` 中文演讲的语速因人而异,我按每分钟 220 个汉字估。这个数是假设,一定要换成你自己测的。
- `HEAD = re.compile(r"^## (.+?) (\d+)$")` 匹配「## 开场 2」这种标题,第一组是段名,第二组是分钟数。`.+?` 是非贪婪匹配,尽量少吃字符,把最后那个数字留给第二组。
- `CJK = re.compile(r"[一-鿿]")` 匹配一个汉字。`一` 到 `鿿` 是常用汉字的 Unicode 范围,和 JS 正则里的 `/[一-鿿]/` 写法一样。只数汉字,标点和英文不算,估算会略偏少。
- `def sections(text: str) -> list[tuple[str, int, str]]:` 返回一个列表,每个元素是(段名,预算分钟,正文)三元组。tuple ≈ TS 的元组类型 `[string, number, string]`。
- `name, budget, body = out[-1]` `out[-1]` 是最后一个元素,≈ JS 的 `out.at(-1)`。一行拆成三个变量,≈ JS 的数组解构。
- `out[-1] = (name, budget, body + line)` tuple 不能改,所以每读一行正文就造一个新的 tuple 替换掉最后一个。
- `elif need > budget * 1.2:` 超过预算 20% 就提醒。现场讲的时候通常比你在家念得慢,还会被提问打断。
- `elif need < budget * 0.5:` 稿子撑不到预算的一半,要么补内容,要么把时间让给别的段。

</div>

```bash
uv run python -m part10.talk_time part10/samples/talk.md
```

```text
开场     预算  2 分钟  稿子  183 字 ≈  0.8 分钟  稿子不到一半,补内容或缩预算
约束     预算  3 分钟  稿子   68 字 ≈  0.3 分钟  稿子不到一半,补内容或缩预算
方案对比   预算  5 分钟  稿子  287 字 ≈  1.3 分钟  稿子不到一半,补内容或缩预算
数据     预算  4 分钟  稿子   25 字 ≈  0.1 分钟  数据还没有
事后看    预算  3 分钟  稿子   40 字 ≈  0.2 分钟  稿子不到一半,补内容或缩预算
问答     预算  3 分钟  稿子    0 字 ≈  0.0 分钟  (没写稿,临场讲)
总预算 20 分钟
```

我自己写那段开场的时候,感觉已经写了很多,结果只有 183 个汉字,按假设的语速不到一分钟。「方案对比」那段在屏幕上看着是一大段,讲出来才一分多钟。20 分钟的分享,按每分钟 220 字算要四千多字的内容量,大多数人第一次准备都严重低估。这个脚本的用处就是把「感觉」换成数字,和 Day 645 用 Wilson 区间把「感觉 Agent 更好」换成数字是一回事。

「数据」那段又一次被标出来:还没有数据。文章和演讲卡在同一个地方,说明真正缺的是实验,不是文笔。

几个准备时的习惯。**录一遍自己讲的视频,回看一次**,你会听到很多口头禅和讲不清楚的地方,这是最便宜的排练。**幻灯片一页一个意思**,标题就写这一页的结论,比如「精确缓存命中率低于 5%,但不会串账号」,而不是「缓存方案对比」。**讲完把幻灯片和录像放到个人站上**,一次分享就变成了一件长期能展示的作品。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tU4y187xz&autoplay=0&high_quality=1" title="【公开课】《如何说话&amp;演讲How to Speak》-帕特里克·温斯顿(Patrick Winston)麻省理工大学教授-中英双语" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>养猪特派员(搬运)· 【公开课】《如何说话&演讲How to Speak》- 帕特里克·温斯顿 · 63 分钟,中英双语字幕。MIT 教授 Patrick Winston 的经典讲座,原版在 MIT OpenCourseWare 的 YouTube 频道。时间紧就看前 20 分钟,讲怎么开场、怎么结尾、幻灯片上该放多少字。</figcaption>
</figure>

## 时间怎么分配

这几件事很容易变成无底洞,也很容易因为看不到回报而放弃。我的建议是每周固定 3 到 5 小时,按季度定具体目标,比如:

- 第一个季度:1 个准备好的 issue 或被合并的文档 PR,1 篇踩坑文章,把一个小项目按今天的检查开源出去。
- 第二个季度:2 篇文章,其中 1 篇是带实测数据的设计决策;1 次组内分享。
- 第三个季度:1 次公司外的分享,讲稿就是第二季度那篇文章。

注意这几样东西是互相喂养的:项目产生踩坑和数据,写成文章;文章改成讲稿;分享收到的问题又变成下一篇文章或者项目的 issue。起点永远是真实做过的事,没有项目做底的个人品牌撑不了多久。

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `~/oss-practice/cloudledger-mcp/` | 演示泄露用的假项目,key 都是假的 | 不花 |
| `part10/release_check.py` | 开源前检查:许可证、README、`.env`、密钥、大文件 | 不花 |
| `part10/title_check.py` | 博客标题检查 | 不花 |
| `part10/samples/adr/0002-缓存只做精确匹配.md` | 补全正文的 ADR | 不花 |
| `part10/adr_outline.py` | ADR 扩写成大纲并核对数字 | 一次 ¥0.0039 |
| `part10/samples/talk.md` | 分享讲稿的开头 | 不花 |
| `part10/talk_time.py` | 按字数估算每段时长 | 不花 |
| `part10/ex647_*.py`(练习) | 练习的参考答案 | 不花 |

## 动手练习

**练习 1:让检查器也查历史。** 写一个函数,用 `git log -p --all` 扫描仓库全部历史里**新加入**的行,找出疑似密钥,报告是哪个提交加进来的。复用 `release_check.py` 里的 `SECRET`。在修好之后的 `cloudledger-mcp` 上跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex647_history.py
import subprocess
import sys
from pathlib import Path

from part10.release_check import SECRET

def history_secrets(repo: Path) -> list[str]:
    log = subprocess.run(["git", "log", "-p", "--all", "--format=commit %h"],
                         cwd=repo, capture_output=True, text=True, check=True).stdout
    found: list[str] = []
    commit = ""
    for line in log.splitlines():
        if line.startswith("commit "):
            commit = line.split()[1]
        elif line.startswith("+") and SECRET.search(line):
            found.append(f"提交 {commit} 加入过疑似密钥:{line[1:40]}")
    return found

if __name__ == "__main__":
    hits = history_secrets(Path(sys.argv[1]))
    for h in hits:
        print("-", h)
    print(f"历史里 {len(hits)} 处")
```

<div class="line-notes">

- `from part10.release_check import SECRET` 复用同一套密钥规则,改一处两边都生效。
- `log = subprocess.run(["git", "log", "-p", "--all", "--format=commit %h"],` `-p` 显示每个提交的改动,`--all` 包括所有分支,`--format=commit %h` 让每个提交的头只占一行,形如 `commit bcc34f9`。
- `if line.startswith("commit "):` 遇到提交头就记下提交号,后面的改动行都属于它。
- `elif line.startswith("+") and SECRET.search(line):` 只看 `+` 开头的行,也就是被**加入**的内容。删掉的行虽然也含 key,但它第一次出现的那个提交才是源头。
- `found.append(f"提交 {commit} 加入过疑似密钥:{line[1:40]}")` 打印到第 40 个字符,能看出是哪个变量,但看不到完整的 key。

</div>

```bash
uv run python -m part10.ex647_history ~/oss-practice/cloudledger-mcp
```

```text
- 提交 bcc34f9 加入过疑似密钥:LLM_API_KEY=sk-FAKE00000000000000000000
- 提交 bcc34f9 加入过疑似密钥:API_KEY = os.environ.get("LLM_API_KEY",
历史里 2 处
```

当前文件 0 个问题,历史里 2 处。第二条只截到 40 个字符,没露出 key 本身,但足够你定位。真实项目用 [gitleaks](https://github.com/gitleaks/gitleaks),它默认就扫历史,规则也多得多;可以把它做成 git 的 pre-commit 钩子,提交前自动跑。

</details>

**练习 2:改标题。** 把 `title_check.py` 里没通过的前三个标题各改写一次,让它们通过检查,而且信息比原来多。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex647_titles.py
from part10.title_check import title_problems

rewrites = {
    "关于 Agent 的一些思考": "单 Agent 和多 Agent 跑同一批 50 个工单:成功率和成本对比",
    "浅谈 RAG": "CloudLedger 帮助中心 RAG:切块从 800 字改到 300 字,命中率变化",
    "LangGraph interrupt 不配 checkpointer,恢复时才报错": "LangGraph 1.x:interrupt 不配 checkpointer 恢复才报错",
}
for old, new in rewrites.items():
    print(f"{old}\n  → {new}  {title_problems(new) or 'OK'}")
```

<div class="line-notes">

- `rewrites = {` 字典的键是原标题,值是改写后的标题。
- `for old, new in rewrites.items():` `.items()` 同时取键和值,≈ JS 的 `Object.entries(rewrites)`。

</div>

```bash
uv run python -m part10.ex647_titles
```

```text
关于 Agent 的一些思考
  → 单 Agent 和多 Agent 跑同一批 50 个工单:成功率和成本对比  OK
浅谈 RAG
  → CloudLedger 帮助中心 RAG:切块从 800 字改到 300 字,命中率变化  OK
LangGraph interrupt 不配 checkpointer,恢复时才报错
  → LangGraph 1.x:interrupt 不配 checkpointer 恢复才报错  OK
```

第三条我第一次改成「LangGraph 1.x 的 interrupt 不配 checkpointer,恢复时才报错」,48 个字符超长了,删掉「的」和「时」才过。版本号 `1.x` 很有用(我 10 月 22 日查 PyPI,langgraph 是 1.2.16),框架换大版本时行为可能变,读者一看就知道这篇适不适用于自己。

**注意:** 前两个新标题里的数字是实验设计(50 个工单、800 改 300),不是结果。标题里如果要写「成功率从 X 到 Y」,那个 X 和 Y 必须是你真跑出来的。

</details>

**练习 3:喂给 `invented()` 一份编了数字的大纲。** 手写一份假大纲,标题写「缓存省了 40% 成本」,要点里写「延迟降了 3 倍」,看 `invented()` 能不能抓出来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex647_invented.py
from pathlib import Path

from part10.adr_outline import invented

adr = Path("part10/samples/adr/0002-缓存只做精确匹配.md").read_text(encoding="utf-8")
fake = {"title": "只做精确匹配,缓存省了 40% 成本",
        "sections": [{"heading": "数据", "point": "命中率 5% 以下,延迟降了 3 倍", "numbers": ["40%", "3 倍"]}]}
print("ADR 里没有的数字:", invented(fake, adr))
```

<div class="line-notes">

- `from part10.adr_outline import invented` 只导入函数。`adr_outline.py` 调模型的代码在 `if __name__ == "__main__":` 下面,导入时不会执行,所以这道题不花钱。
- `fake = {"title": "只做精确匹配,缓存省了 40% 成本",` 40% 和 3 倍都是编的,5% 是 ADR 里有的。

</div>

```bash
uv run python -m part10.ex647_invented
```

```text
ADR 里没有的数字: ['3', '40']
```

两个编的数都抓住了,`5` 没有误报。这个检查的弱点也要知道:它只比数字不比意思。如果模型把「命中 256 token」写成「命中率 256%」,数字 256 在 ADR 里出现过,检查照样通过。所以最终还得你读一遍。

</details>

**练习 4:测你自己的语速,写你自己的讲稿开头。** 把 `talk.md` 的开场段大声念一遍,用手机计时,算出你每分钟念多少汉字(183 除以秒数再乘 60),把 `RATE` 改成你的数。然后选你自己的一个项目,按「开场 2、约束 3、方案对比 5、数据 4、事后看 3、问答 3」写一份讲稿的开场和方案对比两段,用 `talk_time.py` 检查。

<details><summary>参考答案</summary>

这道题要你自己念、自己写,我没法替你跑。给一个示范算法:如果你念 183 个字用了 50 秒,语速就是 `183 / 50 × 60 ≈ 220` 字每分钟;用了 60 秒就是 183。念给自己听和站在台上讲不一样,台上通常更慢,还会停顿,保守起见在你测出来的数上再打九折。

讲稿的验收标准:开场第一句是一个具体的事件或数字,不是「今天给大家分享」;`talk_time.py` 显示开场和方案对比两段都没有「超时」,也没有「稿子不到一半」;方案对比里至少有一个被你否掉的方案和否掉它的理由。写完录一遍,回看时记下三个想改的地方。

</details>

**验收标准**:`release_check.py` 在演示仓库上先报 7 个问题、修好后报 0 个,`ex647_history.py` 能找出历史里的 2 处;你能说清楚 key 进过仓库之后为什么必须先作废;`title_check.py` 和 `adr_outline.py` 跑出结果(模型输出允许不同),并且你能指出大纲里哪一节缺实测数据;给你自己的一个项目写一篇文章大纲(五节,数字都标了来源)和一份讲稿开头,两样都过对应的检查。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 许可证(LICENSE) | 规定别人能怎么用你代码的法律文本。没有许可证,代码公开了别人也不能合法使用 |
| MIT / Apache-2.0 | 两种最常用的宽松许可证。MIT 最短最宽松,Apache-2.0 多了专利授权条款 |
| GPL | 「传染性」许可证,别人改了你的代码再发布,也必须开源 |
| `.gitignore` | 告诉 git 哪些文件不跟踪,`.env`、`.venv/` 都该写进去 |
| `.env.example` | 环境变量模板,列出要配的变量名,值留空,要进仓库 |
| `git rm --cached` | 让 git 不再跟踪某个文件,但不删除硬盘上的文件 |
| `git log -S` | 在历史里搜索某个字符串出现或消失的提交 |
| 作废(rotate)密钥 | 在平台上删掉旧 key、生成新 key。key 泄露后唯一可靠的补救 |
| git filter-repo | 改写 git 历史的工具,可以把某个文件或字符串从所有提交里抹掉 |
| `subprocess.run` | Python 里运行外部命令,≈ Node 的 `child_process.execFileSync` |
| TIL | Today I Learned,记录当天学到的一个小知识的短文 |
| Learn in Public | 公开学习过程,不等成为专家才输出 |

## 常见误区

**以为公开在 GitHub 上就是开源。** 没有 LICENSE 文件,默认版权归你,别人法律上不能用。很多公司的工程师被禁止使用没有许可证的代码。

**删掉 `.env` 再提交就以为安全了。** 今天的演示里,当前文件 0 个问题,历史里还有 2 个 key。正确顺序是先作废 key,再决定是改写历史还是用干净的新仓库发布。

**在 `os.environ.get` 里写一个默认 key。** 「本地没配也能跑」的便利,代价是 key 跟着代码一起公开。没配就让它启动失败。

**拿真的 `.env` 演示或测试检查器。** 检查器有 bug 时会把 key 打到屏幕或日志里。演示一律用 `sk-FAKE` 这种假数据,检查器的输出也只打印前几个字符。

**追 star 数。** star 能刷,面试官也知道。十个真实用户和 issue 区里你的回复,比三千个 star 更有说服力。

**写观点不写数据。** 「我认为语义缓存被高估了」没人记得;「精确缓存命中率 X%,语义缓存抽检串号 Y 次」会被反复引用。今天的大纲里「数据」一节是空的,这时该做的是去跑实验,不是换个说法。

**让模型写完文章直接发。** 模型搭架子很好用,但它会编数字,也写不出你踩坑时的那个具体细节,而那个细节正是读者搜过来的原因。

**低估讲稿字数。** 我写的开场看着不少,只有 183 个汉字,不到一分钟。先测自己的语速,再按字数排时间。

## 学习资料

### 文档与文章

- [choosealicense.com](https://choosealicense.com/):GitHub 出的许可证选择指南,三分钟选完;[许可证对比表](https://choosealicense.com/licenses/)列出每种许可证的权限和条件。
- [GitHub Docs:许可证 API](https://docs.github.com/zh/rest/licenses/licenses):今天取 MIT 模板用的接口。
- [GitHub Docs:从仓库中删除敏感数据](https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository):key 进了历史之后怎么办,先作废、再改写历史的完整步骤。
- [GitHub Docs:为仓库贡献者设置准则](https://docs.github.com/zh/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors):给自己的项目写 CONTRIBUTING.md。
- [Make a README](https://www.makeareadme.com/):README 该写哪几节,有模板。
- [Julia Evans:How do you write blog posts?](https://jvns.ca/blog/2016/05/22/how-do-you-write-blog-posts/):怎么写技术博客,短而实用。
- [swyx:Learn in Public](https://www.swyx.io/learn-in-public):为什么要公开学习,怎么开始。
- [Simon Willison:What to blog about](https://simonwillison.net/2022/Nov/6/what-to-blog-about/):他的建议就两类,TIL 和你做的项目。配合他的 [TIL 站](https://til.simonwillison.net/)看一个顶级技术博主怎么用短文积累。

### B 站视频

- 技术胖《程序员写技术博客新手指南》和 Patrick Winston《How to Speak》中英双语版已经嵌在正文里。
- CodeSheep,《为什么程序员必须写技术博客?以及如何写?》(BV1Px411d74c),16 分钟。讲博客对面试的作用,播放量很高。
- axb,《如何做一次公开技术分享》(BV18z421Y7SY),7 分钟。作者刚在 CCF 做完一次开源项目的分享,趁热总结了准备公开分享的要点。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vtIzMaLkCaM" title="LEADERSHIP LAB: The Craft of Writing Effectively" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>UChicago Social Sciences · LEADERSHIP LAB: The Craft of Writing Effectively · 芝加哥大学 Larry McEnerney 的写作课,英文。核心观点是读者不在乎你懂什么,只在乎你的文字对他有没有价值,这和今天「标题写结果」是一回事。</figcaption>
</figure>

- MIT OpenCourseWare,《How to Speak》(YouTube ID Unzc731iCUY),Patrick Winston 讲座的原版,B 站搬运版在正文里。

### 书籍

- Jared Bhatti、Zachary Sarah Corleissen、Jen Lambourne、David Nunez、Heidi Waterhouse,《Docs for Developers: An Engineer's Field Guide to Technical Writing》,Apress,2021。工程师写技术文档的实用手册,讲 README 和教程的章节最直接有用。没查到中文版。
- 芭芭拉·明托,《金字塔原理》,南海出版公司有多个版本。Day 645 用它写一页纸,今天写文章和讲稿一样是结论先行。

### 开源项目与代码

- [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks):专门扫描仓库和历史里的密钥,`release_check.py` 那条正则的完整版。
- [newren/git-filter-repo](https://github.com/newren/git-filter-repo):改写 git 历史的工具,GitHub 官方文档推荐用它删除敏感数据。
- [conanhujinming/How_to_give_a_talk](https://github.com/conanhujinming/How_to_give_a_talk):一位研究者在浙大实验室做「如何做技术演讲」分享的课件,中文,讲稿结构可以参考。

## 自测

1. 你把一个没有 LICENSE 文件的项目推到 GitHub 公开仓库。别人能不能把你的代码用到他们公司的产品里?

<details><summary>答案</summary>

法律上不能。没有许可证的代码,默认版权完全归作者,别人可以看,但没有被授权复制、修改和再发布。公开不等于开源。想让别人用,就加一个许可证:个人项目一般选 MIT(最宽松)或 Apache-2.0(多了专利授权,大公司法务更喜欢)。

</details>

2. 你发现 `.env` 被提交进了仓库,于是 `git rm --cached .env`、加 `.gitignore`、再提交,`release_check.py` 显示 0 个问题。现在可以公开了吗?

<details><summary>答案</summary>

不可以。删除只是在历史上加了一个新提交,加入 key 的那个旧提交还在,别人克隆后 `git show 那个提交号` 就能看到。今天的演示里 `git log -p --all -S 'sk-FAKE'` 在 `bcc34f9` 里找到了两个 key。正确做法:第一步在平台上作废这个 key 并换新的;第二步要么用 git filter-repo 改写历史,要么把当前文件复制到一个新目录重新 `git init`,只公开干净的新仓库。

</details>

3. 「关于 Agent 的一些思考」这个标题有什么问题?怎么改?

<details><summary>答案</summary>

没有具体的技术名词,别人搜不到;「一些思考」说明没有结论;没有结果,读者不知道值不值得点。改法是把场景、方法和结果放进标题,比如「单 Agent 和多 Agent 跑同一批 50 个工单:成功率和成本对比」,前提是你真的跑过这个实验,标题里的结果数字必须是实测的。

</details>

4. 让模型把 ADR 扩写成文章大纲,为什么还要用代码核对数字?核对通过了是不是就没问题了?

<details><summary>答案</summary>

模型会编数字,Day 646 已经看到它在 PR 描述里编文件名和验证步骤。`invented()` 把大纲里的数字和 ADR 里的数字逐个对比,练习 3 里编的 40% 和 3 倍都被抓住了。但通过了也不等于没问题:它只比数字不比意思,模型把「命中 256 token」写成「命中率 256%」也能通过。另外今天的大纲暴露了更重要的问题:「数据」一节只有一个假设值,说明写文章前要先去跑实验拿实测数据。

</details>

5. 面试题:你怎么看工程师写技术博客和做分享?你自己做过什么,对工作有什么帮助?

<details><summary>答案</summary>

答题要点:讲具体的,不要讲空话。比如写过一篇什么文章、数据是什么、带来了什么反馈;做过一次什么主题的分享、被问了什么问题、后来怎么改进了系统。然后讲对工作的帮助:写作逼你把一个决定的约束和取舍想清楚,今天把 ADR 扩写成大纲时就发现「数据」一节是空的,这直接变成了下一个要做的实验;分享时被追问的问题往往就是系统的盲点。如果做得还不多,诚实说,并讲你接下来一个季度的具体计划(比如一篇带实测数据的设计决策文章、一次组内分享)。面试官看的是持续输出的习惯和判断力,不是数量。

</details>

6. 一个 20 分钟的技术分享,你写了一份讲稿,感觉内容挺多。怎么判断它够不够?

<details><summary>答案</summary>

先测自己的语速:念一段已知字数的稿子并计时,算出每分钟多少字,台上通常更慢,再打个九折。然后按段数字数,用 `talk_time.py` 这样的脚本估算每段时长。今天的示范稿开场只有 183 个汉字,按每分钟 220 字不到一分钟,整篇远远不够 20 分钟,而直觉上它「挺多」。最后一定录一遍完整地讲,用真实时长校准。

</details>

## 明天预告

明天是 Day 648 · 进阶结业:资深自检、市场数据、找岗位和谈薪。第十部分的最后一天。这两天攒下的被合并的 PR、文章和分享,明天都会变成自检表上的证据:我们拿资深岗位的真实要求逐项对照,每一项都要能拿出一个文件或链接;再从 JD 数据里算资深档的薪资分位数,讲资深岗位怎么找、为什么要先谈职级再谈薪资,以及怎么比较两个结构不同的 offer。
