---
title: 'Day 646 · 开源影响力(一):JD 怎么说,第一个 PR,贡献阶梯,AI 生成的 PR'
description: '先用脚本数清楚 JD 里「开源」两个字到底有几成是在说贡献,再用 GitHub API 看几个 Agent 框架现在还收不收外部 PR,扫一遍它们对 AI 生成代码的规定。然后在本机用两个假仓库走完 fork、分支、提交、推送,写一份能过检查器的 PR 描述,最后让模型替你写一份,看它在「怎么验证」里编了什么。'
pubDate: 2026-10-22
regime: none
tags: ['open-source', 'github', 'git', 'career', 'python', 'agent-zero']
series: 'agent-zero'
day: 646
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 645](/blog/agent-zero/day-645-influence/) 讲的是公司里的影响力:用 `roi.py` 的回本测算加试点数据生成一页纸,让 `check()` 检查第一句是不是要的决定、每个数字有没有标来源;按调用量而不是团队数算平台采用率;用 Wilson 区间说明 0.4% 对 1.2% 为什么不能说「好三倍」。

那些都是对内的,听众是你的老板和同事,他们至少认识你。今天往外走一步:面试官、陌生公司的招聘方、开源项目的维护者,这些人不认识你,手里关于你的信息只有简历上几行字。他们能自己点开看的东西,比如一个被合并的 PR,分量就很重。今天先讲给别人的项目做贡献,明天讲自己的项目、写作和演讲。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用一个小脚本数清楚 JD 里「开源」两个字有几成是在要贡献经历,知道关键词计数为什么会虚高。
2. 用 GitHub API 判断一个项目现在适不适合当第一个贡献目标,包括它最近合并了多少外部 PR、对 AI 生成的代码有什么规定。
3. 在本机用两个假仓库完整走一遍 fork → 加 upstream → 开分支 → 提交 → 推送,知道每一步对应 GitHub 网页上的哪个按钮。
4. 写一份能过 `pr_lint.py` 检查的 PR 描述,并且能说出为什么不能把模型写的 PR 描述直接贴上去。

预计用时:2.5 小时。脚本部分 1.5 小时,剩下的时间去读两个真实项目的 `CONTRIBUTING.md`。真正提一个 PR 要来回好几轮,会拖几周,今天的目标是把流程走通、把第一个 issue 准备好。

前置:[Day 58](/blog/agent-zero/day-058-git-3/)(GitHub、push 和 PR 的基本操作)、[Day 64](/blog/agent-zero/day-064-httpx-1/)(用 httpx 发请求)、[Day 499](/blog/agent-zero/day-499-resume-2/)(正则)、[Day 640](/blog/agent-zero/day-640-design-docs-1/)(`doc_lint.py` 的分节检查思路)、[Day 136](/blog/agent-zero/day-136-llm-client-2/)(`common/llm.py`)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把贡献阶梯的四级和 PR 描述的四段默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## JD 里怎么说开源

先看招聘方到底要不要这个。站长 10 月 12 日抓的那批 JD(Day 1 用过,880 条),我用关键词「开源 / open source / GitHub」粗筛了一遍有正文的部分:国内 318 条里命中 83 条(26.1%),海外 185 条里命中 50 条(27.0%)。看上去四分之一的岗位都提了开源,很多人看到这里就觉得「必须有开源经历」。

我把命中的逐条读了一遍,发现大量是噪音。「了解主流开源模型(如 Qwen、Llama)」说的是会用开源模型,和你有没有贡献过代码无关;「GitHub Actions」「GitHub Copilot」说的是工具。去掉这些,国内真正在说「开源贡献、开源项目、开源作品」的大约 54 条(17% 左右),海外大约 12 条(6% 左右)。海外反而少,原因是海外 JD 里「open-source models」「open-source libraries」这类用法特别多。

这个过程值得自己做一遍,因为以后你还会无数次遇到「X% 的 JD 要求 Y」这种说法,先问一句它是怎么数的。今天在 `part10/samples/` 下放一个 10 条的小样本,全部是那批 JD 的真实片段(只摘了相关的一句,标点有改动),7 条在说贡献,3 条是噪音:

```json
[
  {"company": "美团", "title": "履约技术-Agent工程开发", "text": "有突出的 Agent 相关开源作品或项目实践者,年限可适当放宽。"},
  {"company": "酷加科技", "title": "AI Agent 全栈开发工程师", "text": "有拿得出手的个人项目或开源贡献——我们看解决问题的品味,不看 star 数。"},
  {"company": "字节跳动", "title": "Agent技术研发工程师-火山方舟大模型平台", "text": "具备快速复现论文及工程化能力,开源项目贡献者优先。"},
  {"company": "腾讯", "title": "tRPC-AI原生开发工程师-Agent框架方向", "text": "负责开源社区代码PR的Code Review(CR)处理,保证代码质量。"},
  {"company": "G-Research", "title": "Applied AI Engineer", "text": "Contributions to open-source AI projects, technical writing or conference talks."},
  {"company": "Stripe", "title": "Forward Deployed Engineer", "text": "Written open-source developer tooling. Published your work (code, presentations...)."},
  {"company": "Tether", "title": "AI Harness Engineer", "text": "Open-source experience is a plus."},
  {"company": "富泽人寿", "title": "信息科技中心AI应用开发岗", "text": "了解主流开源模型(如Qwen、ChatGLM、Llama等)的微调、推理部署流程。"},
  {"company": "TEKsystems", "title": "Senior AI Engineer", "text": "Maintaining CI/CD pipelines using tools such as GitHub Actions, GitLab CI, Jenkins."},
  {"company": "北京中兵数字科技", "title": "AI智能体(FDE)工程师", "text": "熟练使用 AI 编程辅助工具(如 Claude Code、Cursor、Codex、GitHub Copilot 等)。"}
]
```

把它存成 `agent-zero-lab/part10/samples/oss_jds.json`。这是数据不是代码,可以直接复制。然后写 `part10/oss_jd.py`:

```python
# agent-zero-lab/part10/oss_jd.py
import json
import re
from pathlib import Path

NAIVE = re.compile(r"开源|open[\s-]?source|github", re.I)
NOISE = re.compile(r"开源模型|github (actions|copilot)|copilot", re.I)
DUTY = re.compile(r"负责.*开源|PR的Code Review", re.I)

jds = json.loads(Path("part10/samples/oss_jds.json").read_text(encoding="utf-8"))
naive = [j for j in jds if NAIVE.search(j["text"])]
real = [j for j in naive if not NOISE.search(j["text"])]
print(f"关键词命中 {len(naive)}/{len(jds)},去掉开源模型和 GitHub 工具后剩 {len(real)}")
for j in real:
    kind = "岗位职责" if DUTY.search(j["text"]) else "加分项"
    print(f"  [{kind}] {j['company']}:{j['text'][:40]}")
```

<div class="line-notes">

- `NAIVE = re.compile(r"开源|open[\s-]?source|github", re.I)` 粗筛用的正则。`open[\s-]?source` 能同时匹配 `open source`、`open-source`、`opensource`;`re.I` 是忽略大小写,≈ JS 正则的 `/…/i`。正则的写法在 [Day 499](/blog/agent-zero/day-499-resume-2/) 讲过。
- `NOISE = re.compile(r"开源模型|github (actions|copilot)|copilot", re.I)` 噪音规则:提到开源模型、GitHub 的工具,都不算在要贡献经历。这三条是我读完 83 条命中之后总结出来的,不是拍脑袋。
- `DUTY = re.compile(r"负责.*开源|PR的Code Review", re.I)` 区分「加分项」和「岗位职责」。腾讯那条不是要你有贡献经历,是这个岗位本身就要维护开源项目、审外部 PR,后面会说为什么这条很有意思。
- `jds = json.loads(Path("part10/samples/oss_jds.json").read_text(encoding="utf-8"))` 和 [Day 498](/blog/agent-zero/day-498-resume-1/) 读 `jds.json` 一模一样,得到一个 10 个元素的 list。
- `naive = [j for j in jds if NAIVE.search(j["text"])]` 列表推导式,≈ JS 的 `jds.filter(j => NAIVE.test(j.text))`。实跑 10 条全中,因为样本就是从命中里挑的。
- `real = [j for j in naive if not NOISE.search(j["text"])]` 在命中的里面再去掉噪音,剩 7 条。
- `print(f"  [{kind}] {j['company']}:{j['text'][:40]}")` `[:40]` 只打印前 40 个字符,≈ JS 的 `.slice(0, 40)`。

</div>

在 `agent-zero-lab/` 根目录跑:

```bash
uv run python -m part10.oss_jd
```

```text
关键词命中 10/10,去掉开源模型和 GitHub 工具后剩 7
  [加分项] 美团:有突出的 Agent 相关开源作品或项目实践者,年限可适当放宽。
  [加分项] 酷加科技:有拿得出手的个人项目或开源贡献——我们看解决问题的品味,不看 star 数。
  [加分项] 字节跳动:具备快速复现论文及工程化能力,开源项目贡献者优先。
  [岗位职责] 腾讯:负责开源社区代码PR的Code Review(CR)处理,保证代码质量。
  [加分项] G-Research:Contributions to open-source AI projects
  [加分项] Stripe:Written open-source developer tooling. P
  [加分项] Tether:Open-source experience is a plus.
```

小样本是我挑出来的,比例没有意义,有意义的是这几句话本身。几条值得多读两遍:

- 美团写「年限可适当放宽」。开源作品在这里不只是加分,是能抵年限的。对一个前端转过来、Agent 经验不到一年的人,这句话的分量很大。
- 酷加写「看解决问题的品味,不看 star 数」。招聘方知道 star 能刷,他们要看的是你怎么解决问题。
- G-Research 把开源贡献、技术写作、会议演讲放在同一句里,Stripe 写的是「Published your work (code, presentations...)」。招聘方眼里这三样是一类东西:**能公开查验的证据**。所以今天和明天其实在讲同一件事。
- 腾讯那条是岗位职责:维护开源框架,审外部 PR。坐在那个位置上的人,每天的痛点就是今天后半段要讲的 AI 生成 PR。你理解了维护者的处境,提 PR 时就知道怎么让对方省事。

结论很朴素:开源贡献不是 Agent 岗位的硬门槛,国内大约六分之一的 JD 写了它,几乎都写在加分项里。但在两种情况下它特别值钱:一是你的履历不够亮,需要一样别人能自己点开验证的东西;二是你想拿海外远程岗,对方对你几乎一无所知。

## 选项目:用 GitHub API 看它还收不收外部 PR

选第一个贡献目标,我的标准有四条:

1. **你在用的。** 这门课用过的 MCP Python SDK、LangGraph、OpenAI Agents SDK、promptfoo、Langfuse、Pydantic AI 都是候选。用过才知道哪里有坑。
2. **活跃的。** 最近几天就有提交,外部 PR 有人合并。
3. **有贡献指南的。** 有 `CONTRIBUTING.md`,告诉你规矩。
4. **还欢迎外部 PR 的。** 这一条是 2026 年新加的,下面会看到为什么。

活跃程度靠眼睛看仓库首页也行,但我更想让你用 API 看一次,因为「最近合并的 PR 里有几个是外人写的」这件事,网页上要翻很久。GitHub 有公开的 REST API,不登录每小时能调 60 次,够今天用。它和你在前端里 `fetch` 一个接口没有区别:浏览器地址栏打开 `https://api.github.com/repos/langchain-ai/langgraph` 就能看到一大段 JSON。

先写第一版 `part10/repo_health_v1.py`。用到的 httpx 在 [Day 64](/blog/agent-zero/day-064-httpx-1/) 学过,如果你的 `agent-zero-lab` 还没把它写进依赖,先在根目录跑一次 `uv add httpx`(我 2026 年 10 月 22 日查 PyPI,最新是 0.28.1)。

```python
# agent-zero-lab/part10/repo_health_v1.py
import sys
from datetime import datetime, timezone

import httpx

API = "https://api.github.com/repos/"
OUTSIDERS = {"CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"}

HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "agent-zero-lab"}

def get(url: str):
    resp = httpx.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.json()

def health(repo: str) -> dict:
    info = get(API + repo)
    pulls = get(API + repo + "/pulls?state=closed&per_page=50")
    merged = [p for p in pulls if p["merged_at"]]
    outside = [p for p in merged if p["author_association"] in OUTSIDERS]
    pushed = datetime.fromisoformat(info["pushed_at"].replace("Z", "+00:00"))
    return {
        "repo": repo,
        "stars": info["stargazers_count"],
        "days_since_push": (datetime.now(timezone.utc) - pushed).days,
        "merged": len(merged),
        "outside": len(outside),
    }

if __name__ == "__main__":
    for repo in sys.argv[1:]:
        h = health(repo)
        print(f"{h['repo']:<36} ★{h['stars']:>7,}  {h['days_since_push']:>3} 天前有提交  "
              f"最近 50 个关闭的 PR 里合并 {h['merged']:>2} 个,外部贡献者 {h['outside']:>2} 个")
```

<div class="line-notes">

- `OUTSIDERS = {"CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"}` 每个 PR 的 JSON 里有一个 `author_association` 字段,表示作者和这个仓库的关系。`OWNER`、`MEMBER`(组织成员)、`COLLABORATOR`(被加了权限的人)算自己人,集合里这四种算外人。`{...}` 是集合(set),≈ JS 的 `new Set([...])`。
- `HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "agent-zero-lab"}` GitHub 要求请求带 `User-Agent`,不带会被拒;`Accept` 是官方文档推荐的写法。
- `resp = httpx.get(url, headers=HEADERS, timeout=20)` ≈ `await fetch(url, { headers })`,只是这里是同步的,不用 await。httpx 默认会读环境变量里的代理设置,国内网络开着系统代理也能用。
- `resp.raise_for_status()` 状态码是 4xx/5xx 就抛异常。超过每小时 60 次的限额时你会在这里看到 403。
- `pulls = get(API + repo + "/pulls?state=closed&per_page=50")` 取最近 50 个已关闭的 PR。已关闭包括合并的和被拒的,所以下一行要再筛。只调两次 API:仓库信息一次,PR 列表一次。
- `merged = [p for p in pulls if p["merged_at"]]` 没合并的 PR 这个字段是 `None`,在 if 里当假,≈ JS 里 `null` 是 falsy。
- `pushed = datetime.fromisoformat(info["pushed_at"].replace("Z", "+00:00"))` GitHub 返回 `2026-10-22T03:12:45Z` 这种时间。`Z` 表示 UTC,换成 `+00:00` 是为了兼容老版本 Python 的 `fromisoformat`,≈ JS 的 `new Date("...Z")`。
- `"days_since_push": (datetime.now(timezone.utc) - pushed).days,` 两个时间相减得到一个时间差对象,`.days` 取天数。两边都要带时区,一个带一个不带会报 `TypeError: can't subtract offset-naive and offset-aware datetimes`。
- `for repo in sys.argv[1:]:` `sys.argv` 是命令行参数列表,≈ Node 的 `process.argv`;`[0]` 是脚本名,所以从 `[1:]` 开始。
- `print(f"{h['repo']:<36} ★{h['stars']:>7,}` `:<36` 左对齐占 36 格,`:>7,` 右对齐占 7 格并加千分位逗号,≈ JS 的 `padEnd(36)` 加 `toLocaleString()`。

</div>

挑四个这门课用过的项目跑一下:

```bash
uv run python -m part10.repo_health_v1 modelcontextprotocol/python-sdk langchain-ai/langgraph openai/openai-agents-python promptfoo/promptfoo
```

```text
modelcontextprotocol/python-sdk      ★ 24,636    4 天前有提交  最近 50 个关闭的 PR 里合并 15 个,外部贡献者  8 个
langchain-ai/langgraph               ★ 43,684    0 天前有提交  最近 50 个关闭的 PR 里合并 23 个,外部贡献者 21 个
openai/openai-agents-python          ★ 30,211    0 天前有提交  最近 50 个关闭的 PR 里合并 49 个,外部贡献者 22 个
promptfoo/promptfoo                  ★ 26,252    0 天前有提交  最近 50 个关闭的 PR 里合并 46 个,外部贡献者 46 个
```

这是 10 月 22 日的数字,你跑的时候会不一样。看上去 promptfoo 最友好:合并的 46 个 PR 全是外人写的。这个结果让我起了疑心,哪有项目自己人一个 PR 都不提。我把 promptfoo 那 46 个 PR 的作者打出来看了一眼:

```text
renovate[bot]      Bot   CONTRIBUTOR   39 个
mldangelo-oai      User  CONTRIBUTOR    5 个
dependabot[bot]    Bot   CONTRIBUTOR    1 个
alandelong-oai     User  CONTRIBUTOR    1 个
```

46 个里 40 个是机器人。renovate 和 dependabot 是自动升级依赖的机器人,它们提的 PR 也会被合并,`author_association` 也是 `CONTRIBUTOR`。剩下两个人名字都带 `-oai` 后缀,看起来更像是项目自己的人。这里有第二个坑:**组织成员如果把自己的成员身份设成不公开,API 里显示的也是 `CONTRIBUTOR`**。所以「外部贡献者」这一列,第一版数的是「机器人 + 不公开的成员 + 真外人」。

改第二版 `part10/repo_health.py`,三处改动:排除机器人,按人头去重,再单独数一下首次贡献者(`FIRST_TIME_CONTRIBUTOR`,这个状态只有真外人才会有)。

```python
# agent-zero-lab/part10/repo_health.py
import sys
from datetime import datetime, timezone

import httpx

API = "https://api.github.com/repos/"
OUTSIDERS = {"CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"}

HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "agent-zero-lab"}

def get(url: str):
    resp = httpx.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.json()

def health(repo: str) -> dict:
    info = get(API + repo)
    pulls = get(API + repo + "/pulls?state=closed&per_page=50")
    merged = [p for p in pulls if p["merged_at"] and p["user"]["type"] != "Bot"]
    outside = {p["user"]["login"] for p in merged if p["author_association"] in OUTSIDERS}
    first = [p for p in merged if p["author_association"] in {"FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"}]
    pushed = datetime.fromisoformat(info["pushed_at"].replace("Z", "+00:00"))
    return {
        "repo": repo,
        "stars": info["stargazers_count"],
        "days_since_push": (datetime.now(timezone.utc) - pushed).days,
        "merged": len(merged),
        "outside_people": len(outside),
        "first_timers": len(first),
    }

if __name__ == "__main__":
    for repo in sys.argv[1:]:
        h = health(repo)
        print(f"{h['repo']:<32} ★{h['stars']:>7,}  {h['days_since_push']:>2} 天前有提交  "
              f"人写的已合并 PR {h['merged']:>2} 个,非成员作者 {h['outside_people']:>2} 人,首次贡献 {h['first_timers']} 个")
```

<div class="line-notes">

- `merged = [p for p in pulls if p["merged_at"] and p["user"]["type"] != "Bot"]` 每个 PR 的 `user` 里有 `type` 字段,机器人账号是 `"Bot"`。两个条件用 `and` 连,≈ JS 的 `&&`。
- `outside = {p["user"]["login"] for p in merged if p["author_association"] in OUTSIDERS}` 花括号版的推导式得到的是集合,自动去重。同一个人提了 7 个 PR,只算 1 人。≈ JS 的 `new Set(merged.filter(...).map(p => p.user.login))`。
- `first = [p for p in merged if p["author_association"] in {"FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"}]` 第一次给这个仓库提 PR 的人。你提的第一个 PR,作者状态就是这个。
- `"outside_people": len(outside),` 集合也能用 `len()` 求大小,≈ JS 的 `set.size`。

</div>

```bash
uv run python -m part10.repo_health modelcontextprotocol/python-sdk langchain-ai/langgraph openai/openai-agents-python promptfoo/promptfoo
```

```text
modelcontextprotocol/python-sdk  ★ 24,636   4 天前有提交  人写的已合并 PR 14 个,非成员作者  1 人,首次贡献 0 个
langchain-ai/langgraph           ★ 43,684   0 天前有提交  人写的已合并 PR 13 个,非成员作者  4 人,首次贡献 0 个
openai/openai-agents-python      ★ 30,211   0 天前有提交  人写的已合并 PR 31 个,非成员作者  2 人,首次贡献 0 个
promptfoo/promptfoo              ★ 26,252   0 天前有提交  人写的已合并 PR  6 个,非成员作者  2 人,首次贡献 0 个
```

画面完全变了。四个项目都很活跃,但最近 50 个关闭的 PR 里,一个首次贡献者的 PR 都没有被合并。「非成员作者」那一列还包括不公开身份的成员,真外人只会更少。

这不是巧合,下一节读它们的贡献指南就知道原因了。先记住两个教训,都和数据有关:**第一版数字好看的时候最该怀疑**;**API 字段的名字不等于它的意思**(`CONTRIBUTOR` 不等于外人)。后面你给 AgentOps 做任何看板时都会遇到同样的问题。

## 读贡献指南:2026 年的规矩变了

光看数字不够,得读规矩。写一个小扫描器 `part10/ai_policy.py`,把几个项目的 `CONTRIBUTING.md` 和 `AI_POLICY.md` 拉下来,数一数提到 AI、CLA/DCO、「先开 issue」的行。原始文件从 `raw.githubusercontent.com` 取,这个域名不占 API 的 60 次限额。

```python
# agent-zero-lab/part10/ai_policy.py
import re
import sys

import httpx

RAW = "https://raw.githubusercontent.com/{repo}/HEAD/{path}"
PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "AI_POLICY.md"]
RULES = {
    "AI": re.compile(r"\b(AI|LLM|Copilot|Claude|Cursor|generated)\b", re.I),
    "CLA/DCO": re.compile(r"\b(CLA|DCO|Signed-off-by)\b"),
    "先开 issue": re.compile(r"open an issue|create an issue|discuss", re.I),
}

def fetch(repo: str, path: str) -> str | None:
    resp = httpx.get(RAW.format(repo=repo, path=path), timeout=20, follow_redirects=True)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.text

def scan(repo: str) -> None:
    print(f"== {repo}")
    for path in PATHS:
        text = fetch(repo, path)
        if text is None:
            continue
        print(f"  {path}:{len(text.splitlines())} 行")
        for name, pattern in RULES.items():
            hits = [line.strip() for line in text.splitlines() if pattern.search(line)]
            first = hits[0][:70] if hits else ""
            print(f"    {name:<8}{len(hits):>3} 行  {first}")

if __name__ == "__main__":
    for repo in sys.argv[1:]:
        scan(repo)
```

<div class="line-notes">

- `RAW = "https://raw.githubusercontent.com/{repo}/HEAD/{path}"` `HEAD` 指仓库的默认分支,不用管它叫 `main` 还是 `master`。`{repo}` 是占位符,下面用 `.format()` 填,≈ JS 模板字符串先留空、后填值。
- `PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "AI_POLICY.md"]` 贡献指南可能在根目录,也可能在 `.github/` 下;`AI_POLICY.md` 是这两年一些项目新加的独立文件。
- `"AI": re.compile(r"\b(AI|LLM|Copilot|Claude|Cursor|generated)\b", re.I),` `\b` 是单词边界,保证 `AI` 不会匹配到 `OpenAI` 中间那两个字母。
- `"CLA/DCO": re.compile(r"\b(CLA|DCO|Signed-off-by)\b"),` CLA 和 DCO 是两种「我有权贡献这段代码」的声明,下面名词解释里有。这一条故意不加 `re.I`,因为这几个缩写在文档里总是大写的,小写的 `cla` 更可能是别的意思。
- `def fetch(repo: str, path: str) -> str | None:` 返回值是字符串或 `None`,≈ TS 的 `string | null`。
- `if resp.status_code == 404:` 文件不存在不是错误,返回 `None` 让调用方跳过。其他错误码交给下一行抛出来。
- `return resp.text` ≈ `await resp.text()`。
- `hits = [line.strip() for line in text.splitlines() if pattern.search(line)]` 逐行找命中的行。`strip()` 去掉首尾空白,≈ JS 的 `trim()`。
- `first = hits[0][:70] if hits else ""` Python 的三元表达式写成 `A if 条件 else B`,≈ JS 的 `hits.length ? hits[0].slice(0, 70) : ""`。空列表在 if 里当假。

</div>

```bash
uv run python -m part10.ai_policy modelcontextprotocol/python-sdk openai/openai-agents-python ghostty-org/ghostty
```

我第一次跑的时候,拉第二个仓库时卡了二十秒,然后是一大段 traceback,最后两行是:

```text
httpcore.ConnectTimeout: _ssl.c:993: The handshake operation timed out
httpx.ConnectTimeout: _ssl.c:993: The handshake operation timed out
```

这是国内网络访问 `raw.githubusercontent.com` 时常见的情况,TLS 握手没在 20 秒内完成。代码没问题,重跑一次就过了。如果你经常遇到,可以把 `timeout` 调大,或者在 `fetch` 外面包一层重试(练习里不要求)。重跑的结果:

```text
== modelcontextprotocol/python-sdk
  CONTRIBUTING.md:192 行
    AI        6 行  ### AI-Assisted Contributions
    CLA/DCO   0 行  
    先开 issue  2 行  These always need discussion on an issue before anyone writes code:
== openai/openai-agents-python
  CONTRIBUTING.md:82 行
    AI        1 行  - Provide credentials for explicitly authorized live tests through the
    CLA/DCO   0 行  
    先开 issue  3 行  **Pull requests are limited to repository collaborators. We do not acc
== ghostty-org/ghostty
  CONTRIBUTING.md:195 行
    AI        9 行  without the aid of AI tools, do not contribute to this project.
    CLA/DCO   0 行  
    先开 issue 29 行  for anyone considering opening an **issue**, **discussion** or **pull 
  AI_POLICY.md:65 行
    AI       28 行  # AI Usage Policy
    CLA/DCO   0 行  
    先开 issue  2 行  - **Issues and discussions can use AI assistance but must have a full
```

扫描器只是帮你定位,结论要读原文。OpenAI Agents SDK 那条「AI」命中是误报,那一行的后半句是「generated artifacts」,说的是别把凭证写进生成的文件里。可它「先开 issue」那条命中的是今天最重要的一句话,我把原文贴出来:

> Pull requests are limited to repository collaborators. We do not accept pull requests from non-collaborators, including documentation or example changes. If you are not a collaborator, please open an issue instead of preparing a pull request.

连文档修改都不收外部 PR 了,只收 issue。这就解释了上面为什么首次贡献者一个都没有。

MCP Python SDK 没有关门,但设了一道闸。它的 `CONTRIBUTING.md` 开头写着「The most useful contribution is a good issue」,接着解释原因:维护团队很小,coding agent 几个小时就能把任何一个 issue 变成看起来像样的 PR,收到的 PR 远远多于能认真读的数量,而认真 review 一个 PR 花的时间和以前一样长。所以规则是,外部 PR 要同时满足两个条件才不会被机器人自动关掉:描述里用 `Fixes #123` 这类关键字关联一个打开的 issue,并且这个 issue 由维护者指派给了你,或者带 `help wanted` 标签。连改错别字也一样,它说这种情况开个 issue 指出来就够了。

关于 AI,它的要求是四条:披露(PR 描述里一行就行)、负责(维护者问你问题时,答案要来自你,而不是从聊天窗口里粘贴)、人在回路里(没有真人看过的 agent 生成的 issue 和 PR 可能直接被关)、issue 写短写实。没披露的 AI 贡献可能被关,屡次违反会被整个 `modelcontextprotocol` 组织拉黑。

Ghostty 更严。它是终端模拟器,和 Agent 没关系,但作者 Mitchell Hashimoto 写的 `AI_POLICY.md` 已经成了很多项目参考的样板。它要求所有 AI 使用都必须披露工具和程度;提交的人必须能在不借助 AI 的情况下解释每一处改动;第一次贡献要先在 discussion 里申请,维护者回复 `!vouch` 才能提 PR,没被担保的 PR 会被自动关掉;提交明显的 AI 垃圾的人会进一个公开的黑名单。它也写明了不是反 AI,项目自己的代码就大量用 AI 写,问题出在「大多数用 AI 的人还不够好」。

Pydantic AI 的贡献指南(它的 `CONTRIBUTING.md` 只有一行,指向 `docs/contributing.md`,练习 1 会遇到)写得更直白:非小改动请先给计划和能跑的例子,不要直接给打磨好的实现;他们可能直接往你的分支推提交、另开一个 PR 取代你的、或者从头重写,出于安全原因他们倾向于重写外部代码而不是原样合并,原作者照样署名。

这几份文件放在一起看,2026 年的情况很清楚。一个合格的 issue(复现步骤、版本、期望和实际行为、你的使用场景)已经从「贡献的第一级」变成了很多项目里「外人唯一能做的贡献」。维护者缺的不是写代码的手,coding agent 写代码比你快;他们缺的是只有你才有的上下文:你在什么场景下踩到的,最小复现长什么样。

开源项目外面也一样。curl 的作者 Daniel Stenberg 在 2026 年 1 月底关掉了 curl 在 HackerOne 上的漏洞赏金,原因是 AI 生成的低质量漏洞报告太多,The Register 等媒体都报道过。这件事说明的不是「别用 AI」,是**你提交的每样东西,都要有一个真人愿意为它负责**。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yuto66ExZ&autoplay=0&high_quality=1" title="PR 不再受欢迎:AI 开源项目如何重写贡献规则" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>isomoes · PR 不再受欢迎:AI 开源项目如何重写贡献规则 · 4 分钟。解读几个 AI 原生的开源项目怎么处理外部 PR,有的直接关掉外部 PR、把代码请求转成 issue。和上面读到的几份规矩对照着看。</figcaption>
</figure>

## 贡献的阶梯

有了上面的背景,贡献的阶梯要重新画一下。以前是「issue → 文档 → 测试和小 bug → 功能」四级,现在每一级之间多了一道「被认可」的门:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="开源贡献阶梯:从好 issue 到功能,每级之间要先被维护者认可">
<text x="320" y="22" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">越往右,合并前需要的信任和沟通越多</text>
<rect x="20" y="190" width="130" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="213" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① 好 issue</text>
<text x="85" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">复现+版本+场景</text>
<rect x="175" y="140" width="130" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② 文档和示例</text>
<text x="240" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先有 issue 再改</text>
<rect x="330" y="90" width="130" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="395" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ 测试和小 bug</text>
<text x="395" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">被指派后动手</text>
<rect x="485" y="40" width="135" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="552" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">④ 功能和设计</text>
<text x="552" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先交计划</text>
<path d="M 85 190 L 85 168 L 175 168" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M 240 140 L 240 118 L 330 118" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<path d="M 395 90 L 395 68 L 485 68" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<text x="130" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">被确认</text>
<text x="285" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">被指派</text>
<text x="440" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">计划被认可</text>
<text x="20" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色:新人现实的起点   琥珀色:要先在 issue 或 discussion 里谈妥</text>
</svg>
<figcaption>2026 年的贡献阶梯。每两级之间那几个灰色小字是新加的门:你的 issue 被维护者确认,你被指派,你的计划被认可。不过门就直接写代码,很可能被机器人自动关掉。</figcaption>
</figure>

**第一级:提一个好 issue。** 不要觉得 issue 不算贡献。在 MCP SDK 那里,它就是外人最主要的贡献方式。一个好 issue 有五样东西:你在做什么(场景)、用的什么版本、最小复现(去掉一切无关代码之后仍然能复现的最短代码)、期望行为、实际行为(报错原文)。你在 SupportPilot 和 AgentOps 里踩过的 SDK 坑就是现成的素材,前提是先在最新版本上确认它还在,再搜一下有没有人提过。

**第二级:文档和示例。** Agent 框架的 API 变得快,文档跟不上是常态。以前这一级可以直接提 PR,现在很多项目要求先有 issue。改之前先看规矩。

**第三级:测试和小 bug。** 从 `good first issue` 或 `help wanted` 标签里找。注意 MCP SDK 写的是 `good first issue` 也要先被指派,而且「只留言要求指派」这种评论不算数,他们希望你真的参与讨论:确认复现、问清楚期望行为、简单说说你打算怎么修。

**第四级:功能和设计。** 必须先讨论。Pydantic AI 甚至建议你开一个只有 `PLAN.md` 的草稿 PR,大功能约 20 分钟视频会议对一下设计。没讨论直接提一千行,不管写得多好,大概率以「方向不符」被关。

Mitchell Hashimoto 有一篇老文章《Contributing to Complex Projects》,讲怎么进入一个陌生的大代码库:先当用户,再读代码的执行路径,再从小处改。现在读它依然有用,而且和他今天的 AI 政策是一脉相承的:你必须真的理解这个系统。

## 一个 PR 从头到尾:用两个假仓库练

真实项目的门越来越窄,第一次就在真实项目上练手,出错了丢人还浪费维护者时间。所以先在本机用两个假仓库把整个流程走一遍。这和 [Day 58](/blog/agent-zero/day-058-git-3/) 推自己的仓库不同:给别人的项目贡献,你手里有三个仓库,关系如下图。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="fork 工作流:upstream、你的 fork 和本地仓库三者的关系">
<rect x="30" y="30" width="170" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">upstream</text>
<text x="115" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">项目的仓库(你没权限)</text>
<rect x="440" y="30" width="170" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">origin(你的 fork)</text>
<text x="525" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GitHub 上你名下</text>
<rect x="235" y="150" width="170" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="175" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">本地仓库</text>
<text x="320" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">你的电脑</text>
<path d="M 200 50 L 440 50" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<text x="320" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">① 网页上点 Fork</text>
<path d="M 500 90 L 380 150" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<text x="500" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">② clone / ⑤ push</text>
<path d="M 140 90 L 260 150" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
<text x="40" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">③ fetch upstream</text>
<path d="M 470 70 L 200 70" fill="none" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="5 4"/>
<text x="320" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">⑥ 网页上开 PR</text>
<text x="320" y="225" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">④ 在本地从 upstream/main 开分支、改、提交</text>
</svg>
<figcaption>三个仓库。你只能往自己的 fork 推,PR 是「请 upstream 从我 fork 的某个分支拉代码」。本地仓库同时连着两个远程:origin 是你的 fork,upstream 是项目本身。</figcaption>
</figure>

在 GitHub 上,①和⑥是网页按钮。本地练习时,我们用两个「裸仓库」(bare repository,只有 git 数据、没有工作文件的仓库,GitHub 服务器上存的就是这种)假装成 upstream 和你的 fork。下面的命令在一个新目录里跑,别在 `agent-zero-lab` 里面跑,免得套娃:

```bash
mkdir -p ~/oss-practice && cd ~/oss-practice

# 假装是维护者:建一个项目,README 里的例子和代码对不上
mkdir seed && cd seed && git init -q && git checkout -q -b main
printf '# tinykit\n\n~~~python\nfrom tinykit import Server\nserver = Server("demo")\n~~~\n' > README.md
printf 'class FastServer:\n    def __init__(self, name):\n        self.name = name\n' > tinykit.py
git add . && git commit -qm "init" && cd ..

# 假装是 GitHub:upstream 是项目仓库,fork.git 是你点 Fork 得到的副本
git clone -q --bare seed upstream.git
git clone -q --bare upstream.git fork.git
rm -rf seed
```

<div class="line-notes">

- `mkdir -p ~/oss-practice && cd ~/oss-practice` 练习目录放在家目录下,随便删。
- `git init -q && git checkout -q -b main` 新建仓库并把分支叫 `main`。新版 git 可以写 `git init -b main` 一步到位;我机器上的 git 是 2.24,太老不支持 `-b`,这样写新旧都能跑。
- `printf '# tinykit` 故意埋一个 bug:README 让用户 `import Server`,可代码里只有 `FastServer`。这类「类改名了文档没跟上」的问题,在 Agent 框架里非常常见。README 里的代码块用 `~~~` 围起来,和三个反引号是一样的 Markdown 写法,只是放进 printf 里不用转义。
- `git clone -q --bare seed upstream.git` `--bare` 克隆出一个裸仓库,当作 GitHub 上的项目仓库。
- `git clone -q --bare upstream.git fork.git` 再从它克隆一个裸仓库,就是你在网页上点 Fork 得到的那份。

</div>

接下来是贡献者要做的事,每一步对应真实流程里的一个动作:

```bash
cd ~/oss-practice
git clone fork.git tinykit
cd tinykit
git remote add upstream ../upstream.git
git remote -v
git fetch upstream
git switch -c docs/fix-readme-server-name upstream/main
```

<div class="line-notes">

- `git clone fork.git tinykit` 克隆你自己的 fork。真实场景是 `git clone git@github.com:<你的用户名>/<项目>.git`。克隆下来的远程自动叫 `origin`。
- `git remote add upstream ../upstream.git` 再加一个远程叫 `upstream`,指向项目本身。真实场景是项目的 https 地址。名字是约定俗成的,所有贡献指南都这么叫。
- `git remote -v` 列出所有远程,确认两个都在。
- `git fetch upstream` 把项目最新的提交拉到本地,但不改你的工作文件。
- `git switch -c docs/fix-readme-server-name upstream/main` 从**项目的最新主干**开一个新分支,而不是从你 fork 的 main。你的 fork 可能已经落后项目好几天,从旧代码开分支,PR 里会出现别人早就修好的冲突。分支名用 `类型/做什么`,维护者一眼能看懂。

</div>

```text
Cloning into 'tinykit'...
done.
origin	.../oss-practice/fork.git (fetch)
origin	.../oss-practice/fork.git (push)
upstream	../upstream.git (fetch)
upstream	../upstream.git (push)
From ../upstream
 * [new branch]      main       -> upstream/main
Switched to a new branch 'docs/fix-readme-server-name'
Branch 'docs/fix-readme-server-name' set up to track remote branch 'main' from 'upstream'.
```

(`origin` 那两行会显示完整的绝对路径,我缩写成了 `.../oss-practice/`。)

改之前先**复现问题**。这一步很多人跳过,可它是你 PR 描述里「怎么验证」那一节的原材料:

```bash
python3 -c "from tinykit import Server"
```

```text
ImportError: cannot import name 'Server' from 'tinykit' (.../oss-practice/tinykit/tinykit.py)
```

这就是 issue 里该贴的「实际行为」。然后改 README,再验证一次,最后提交、推到你的 fork:

```bash
sed -i '' 's/import Server/import FastServer/; s/= Server(/= FastServer(/' README.md
git diff
python3 -c "from tinykit import FastServer; FastServer('demo'); print('ok')"
git commit -am "docs: use FastServer in README example"
git push origin docs/fix-readme-server-name
```

<div class="line-notes">

- `sed -i '' 's/import Server/import FastServer/; s/= Server(/= FastServer(/' README.md` 用 sed 原地替换两处。macOS 的 sed 要写 `-i ''`,Linux 上写 `-i` 就行。你也可以直接在编辑器里改,效果一样。
- `git diff` 提交前看一眼改了什么,只该有 README 的两行。
- `python3 -c "from tinykit import FastServer; FastServer('demo'); print('ok')"` 用改好的写法再跑一次,输出 `ok` 说明 README 的例子现在能用了。
- `git commit -am "docs: use FastServer in README example"` `-a` 自动暂存已跟踪文件的修改。提交信息用 Conventional Commits 格式:`类型: 说明`,`docs` 表示只改了文档。很多 Agent 框架要求这个格式,练习 3 会写一个检查器。
- `git push origin docs/fix-readme-server-name` 推到 **origin**,也就是你的 fork。你没有 upstream 的写权限,推 upstream 会被拒。

</div>

```text
diff --git a/README.md b/README.md
index 66e8148..07f6251 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # tinykit
 
 ~~~python
-from tinykit import Server
-server = Server("demo")
+from tinykit import FastServer
+server = FastServer("demo")
 ~~~
ok
[docs/fix-readme-server-name bd9dfbe] docs: use FastServer in README example
 1 file changed, 2 insertions(+), 2 deletions(-)
To .../oss-practice/fork.git
 * [new branch]      docs/fix-readme-server-name -> docs/fix-readme-server-name
```

在真实的 GitHub 上,push 完你会在 fork 的页面看到一条黄色提示「Compare & pull request」,点它就进入第⑥步:写 PR 描述。顺手把 diff 存下来,下一节要用:

```bash
git diff upstream/main > ~/agent-zero-lab/part10/samples/pr/readme.diff
```

(如果你的 `agent-zero-lab` 不在家目录下,换成它的实际路径;`samples/pr/` 目录不存在就先 `mkdir -p`。)

真实项目里,在 push 之前还有一步:按 `CONTRIBUTING.md` 跑它要求的检查。MCP Python SDK 要求的是 `uv run pytest`、`uv run pyright`、`uv run ruff check .` 和 `uv run ruff format .`,具体以当时的文件为准。

## PR 描述:四段,外加一个检查器

PR 描述我固定写四段:**改了什么、为什么改、怎么验证的、AI 使用说明**。开头一行用 `Fixes #编号` 关联 issue。给国外项目提 PR 用英文写,小节标题用英文:

```markdown
Fixes #42

## What
Update the README example from `Server` to `FastServer`.

## Why
The README imports `Server`, but tinykit only defines `FastServer`, so the first example raises `ImportError` on a fresh clone.

## How I verified
Ran `python3 -c "from tinykit import FastServer; FastServer('demo')"` in the repo root. Before this change the README line `from tinykit import Server` raised `ImportError`; after it, the snippet runs.

## AI disclosure
No AI tools were used for this change.
```

存成 `part10/samples/pr/good.md`。几处讲究:`Fixes #42` 是 GitHub 认的关闭关键字,PR 合并时会自动关掉 42 号 issue,MCP SDK 的机器人也靠它判断你有没有关联 issue;「Why」写的是用户会遇到什么,而不是「我觉得这样更好」;「How I verified」写的是**真跑过的命令和真看到的结果**,就是上一节那两条;「AI disclosure」即使没用 AI 也写一句,让维护者不用猜。

和 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的 `doc_lint.py`、Day 645 的一页纸 `check()` 一样,这种格式要求最适合交给脚本检查。`part10/pr_lint.py` 的 `split_sections` 直接照搬 `doc_lint.py` 的:

```python
# agent-zero-lab/part10/pr_lint.py
import re
import sys
from pathlib import Path

SECTIONS = ["What", "Why", "How I verified", "AI disclosure"]
CLOSING = re.compile(r"\b(Fixes|Closes|Resolves) #\d+")
COMMAND = re.compile(r"`[^`]*(pytest|ruff|pyright|python|uv run)[^`]*`")
MAX_WORDS = 250

def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = ""
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return sections

def lint(text: str) -> list[str]:
    sections = split_sections(text)
    problems = [f"缺少一节:{name}" for name in SECTIONS if name not in sections]
    if not CLOSING.search(text):
        problems.append("没有用 Fixes/Closes/Resolves #编号 关联 issue")
    verified = sections.get("How I verified", "")
    if verified and not COMMAND.search(verified):
        problems.append("[How I verified] 没写跑了哪条命令")
    if sections.get("AI disclosure", "").strip() == "":
        problems.append("[AI disclosure] 是空的")
    words = len(text.split())
    if words > MAX_WORDS:
        problems.append(f"太长了:{words} 个词,维护者没时间读,压到 {MAX_WORDS} 以内")
    return problems

if __name__ == "__main__":
    path = Path(sys.argv[1])
    found = lint(path.read_text(encoding="utf-8"))
    for p in found:
        print("-", p)
    print(f"{path.name}: {len(found)} 个问题")
    sys.exit(1 if found else 0)
```

<div class="line-notes">

- `SECTIONS = ["What", "Why", "How I verified", "AI disclosure"]` 四段的标题。要求标题完全一致,这样检查最简单。
- `CLOSING = re.compile(r"\b(Fixes|Closes|Resolves) #\d+")` GitHub 认的关闭关键字还有小写和 `Fix`、`Close` 等变体,这里只认三个最常用的,够用。`\d+` 是一个或多个数字。
- `COMMAND = re.compile(` 「怎么验证」里必须有一段用反引号包起来、里面带常见命令名的文字。两头那对方括号写的是「任意个非反引号的字符」,保证匹配不会跨过两段 inline code。
- `MAX_WORDS = 250` 英文按词数算。Ghostty 的政策里有一句「AI is very good at being overly verbose」,太长的描述是 AI 生成的典型特征,也是维护者最烦的。
- `def split_sections(text: str) -> dict[str, str]:` 和 Day 640 `doc_lint.py` 里的同名函数一字不差:遇到 `## ` 开头的行就开一个新小节,之后的行都归到这一节。
- `problems = [f"缺少一节:{name}" for name in SECTIONS if name not in sections]` 一个推导式把缺的小节全列出来。`name not in sections` 查的是字典的键,≈ JS 的 `!(name in sections)`。
- `verified = sections.get("How I verified", "")` `.get(键, 默认值)` 键不存在时返回默认值,不会报错,≈ JS 的 `sections["How I verified"] ?? ""`。
- `if verified and not COMMAND.search(verified):` 只有这一节存在时才查命令,缺这一节的问题上面已经报过了,不重复报。
- `words = len(text.split())` `split()` 不传参数时按任意空白切开,≈ JS 的 `text.trim().split(/\s+/)`。
- `sys.exit(1 if found else 0)` 有问题时退出码是 1,方便以后接进 CI 或 git hook,和 `doc_lint.py` 一样。

</div>

```bash
uv run python -m part10.pr_lint part10/samples/pr/good.md
```

```text
good.md: 0 个问题
```

## 让模型替你写 PR 描述,看它编了什么

现在做一个实验:把同一个 diff 交给模型,让它写 PR 描述。这就是「路过式 PR」的作者每天在做的事。`part10/pr_draft.py` 用 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient`:

```python
# agent-zero-lab/part10/pr_draft.py
from pathlib import Path

from common.llm import LLMClient
from part10.pr_lint import lint

ASK = """Write a GitHub pull request description for the diff below.
It fixes issue #42: "README example raises ImportError".
Use exactly these sections: ## What, ## Why, ## How I verified, ## AI disclosure."""

diff = Path("part10/samples/pr/readme.diff").read_text(encoding="utf-8")
llm = LLMClient()
r = llm.chat([{"role": "user", "content": ASK + "\n\n" + diff}], temperature=0)
Path("part10/samples/pr/draft.md").write_text(r.content, encoding="utf-8")
print(r.content)
print("\n检查:", lint(r.content) or "通过")
print(llm.ledger)
```

<div class="line-notes">

- `ASK = """Write a GitHub pull request description for the diff below.` 提示词只给了三样东西:diff、issue 标题、要求的四个小节。模型不知道你跑过什么命令,这是关键。
- `diff = Path("part10/samples/pr/readme.diff").read_text(encoding="utf-8")` 上一节存下来的 diff,只有 README 的两行改动。
- `r = llm.chat([{"role": "user", "content": ASK + "\n\n" + diff}], temperature=0)` `temperature=0` 让输出尽量稳定,方便你和文章对照。
- `Path("part10/samples/pr/draft.md").write_text(r.content, encoding="utf-8")` 存一份,练习 2 要用。
- `print("\n检查:", lint(r.content) or "通过")` 空列表在 `or` 里当假,所以没问题时打印「通过」,≈ JS 的 `problems.length ? problems : "通过"`。

</div>

```bash
uv run python -m part10.pr_draft
```

```text
## What
Updates the README quickstart example to import `FastServer` instead of `Server`.

## Why
Fixes #42. The README example raised `ImportError` because `Server` no longer exists in `tinykit`; the public class is now `FastServer`. Users copying the snippet got a broken first-run experience.

## How I verified
- Confirmed `Server` is not exported from `tinykit` and `FastServer` is.
- Ran the updated snippet locally and it constructs the server without error.
- Rendered the README to confirm the code block displays correctly.

## AI disclosure
This change was prepared with AI assistance (drafting the edit and PR description). I reviewed the diff and verified the snippet manually before submitting.

检查: ['[How I verified] 没写跑了哪条命令']
1 次调用 | 输入 137 / 输出 158 tokens | 约 ¥0.0015
```

花费 ¥0.0015,算式 `(137 × 2 + 158 × 8) / 1,000,000`,价格是 [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 查过的 `deepseek-flash` 高峰价(输入未命中 2 元、输出 8 元,每百万 token)。你跑出来的文字会有出入,但大概率会犯同类的错。

读起来很专业,检查器也只抓到一个格式问题。可是逐句对一下事实,模型只看过一个 diff,它没有运行过任何东西:

- 「Ran the updated snippet locally」:模型没有运行环境,它不可能跑过。碰巧我们上一节真跑过,但那是我们,不是它。
- 「Rendered the README to confirm the code block displays correctly」:没人做过这件事。
- 「I reviewed the diff and verified the snippet manually before submitting」:最后一句用第一人称替你担保。你要是原样贴上去,这句话就成了你的承诺。

我在写这篇时还跑过一次,当时 README 的代码块用的是三个反引号,diff 只差那两行,温度同样是 0。那一次模型写得更离谱:「by inspecting the package's `__init__.py`」,可这个仓库**根本没有** `__init__.py`,只有 `tinykit.py` 和 `README.md`;它还断言「the class was renamed」,这是从 diff 猜的。那次花了 ¥0.0018(输入 135、输出 195 token)。我把那份原文存成了 `part10/samples/pr/draft_run1.md`,练习 2 要用,你可以直接从练习 2 的答案里复制。

两次都过了检查器的大部分规则,只栽在「没写命令」上,因为模型写的 inline code 里没有 `python` 这个词。**格式检查抓不到编造**,它只能保证你没漏掉某一节。维护者问一句「你看的是哪个 `__init__.py`」或者「在哪渲染的」,你就答不上来了,正好撞上 MCP SDK 说的「答案要来自你,而不是从聊天窗口里粘贴」。练习 2 会给检查器加一条规则,专门抓「提到了仓库里不存在的文件」,但更根本的办法只有一个:「How I verified」那一节必须你自己写,而且只写你真跑过的。

我自己的做法是:可以让 coding agent 帮你改代码、甚至帮你起草 What 和 Why,但「How I verified」和「AI disclosure」两节一定手写;披露写具体,比如「Used Claude Code to locate the call sites; wrote the fix and tests myself」。这和 [Day 645](/blog/agent-zero/day-645-influence/) 讲的是同一个道理:你的信用来自每个数字、每句话都经得起追问。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WldXhauP024" title="Getting started with open source contributions for beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GitHub · Getting started with open source contributions for beginners · GitHub 官方讲怎么找项目、怎么提第一个贡献。看它在网页上点 Fork 和 Compare & pull request 的那两段,对应上面图里的①和⑥。</figcaption>
</figure>

## 被要求修改、被拒绝之后

提了之后的事也要有心理准备。

被要求修改时别急着辩解。维护者对项目的理解比你深,按要求改,改完在评论里说一声改了哪里。注意 MCP SDK 提醒的一个细节:PR 被关掉期间要推新提交,不要 force-push,否则 GitHub 没法重新打开这个 PR。

等不到回复很正常。小团队维护的热门项目,一两周没人理是常态。一周后可以礼貌地问一句,不要每天催。

被拒了也正常。问一下原因,把学到的东西用到下一个 issue。Pydantic AI 明确说过他们可能重写你的代码,原作者照样署名。这不算失败,你的 issue 和最小复现已经是项目历史的一部分,面试时一样能讲。

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/samples/oss_jds.json` | 10 条真实 JD 片段 | 不花 |
| `part10/oss_jd.py` | 粗筛「开源」关键词,再去掉噪音 | 不花 |
| `part10/repo_health_v1.py` | 第一版项目健康度,被机器人骗了 | 不花(2 次 API/仓库) |
| `part10/repo_health.py` | 排除机器人、按人头去重、数首次贡献 | 不花(2 次 API/仓库) |
| `part10/ai_policy.py` | 扫贡献指南里的 AI、CLA、先开 issue 规则 | 不花 |
| `~/oss-practice/` | 两个假仓库加本地克隆,练 fork 流程 | 不花 |
| `part10/pr_lint.py` | PR 描述四段检查器 | 不花 |
| `part10/pr_draft.py` | 让模型写 PR 描述再检查 | 一次约 ¥0.0015 |
| `part10/ex646_*.py`(练习) | 练习的参考答案 | 不花 |

## 动手练习

**练习 1:再看两个项目。** 用 `repo_health.py` 和 `ai_policy.py` 看 `langfuse/langfuse` 和 `pydantic/pydantic-ai`,回答:它们最近有没有合并首次贡献者的 PR?贡献指南对 AI 和 CLA 怎么规定?扫描器有没有误报或漏报?

<details><summary>参考答案</summary>

```bash
uv run python -m part10.repo_health langfuse/langfuse pydantic/pydantic-ai
uv run python -m part10.ai_policy pydantic/pydantic-ai langfuse/langfuse
```

```text
langfuse/langfuse                ★ 36,158   0 天前有提交  人写的已合并 PR 48 个,非成员作者 10 人,首次贡献 0 个
pydantic/pydantic-ai             ★ 20,775   0 天前有提交  人写的已合并 PR 43 个,非成员作者  4 人,首次贡献 0 个
== pydantic/pydantic-ai
  CONTRIBUTING.md:1 行
    AI        0 行  
    CLA/DCO   0 行  
    先开 issue  0 行  
== langfuse/langfuse
  CONTRIBUTING.md:664 行
    AI       33 行  - openapi-typescript to generated types based on OpenAPI spec
    CLA/DCO   3 行  When contributing to the Langfuse codebase, you need to agree to the [
    先开 issue  4 行  - Submit and vote on [Ideas](https://github.com/orgs/langfuse/discussi
```

两个项目都很活跃,Langfuse 的非成员作者有 10 人,是今天看过的里面最多的,但最近 50 个里同样没有首次贡献者。

扫描器两处都不准。Pydantic AI 的 `CONTRIBUTING.md` 只有 1 行,打开一看内容是 `docs/contributing.md`:它在仓库里是一个符号链接(symlink,≈ 快捷方式),raw 地址返回的是链接指向的路径,不是内容。真正的规矩在 `docs/contributing.md`,上面正文引用的「先给计划、可能重写你的代码」就出自那里。Langfuse 的 AI 命中 33 行,第一条就是误报(「generated types」);它的 `CONTRIBUTING.md` 里确实有大段写给 Cursor、Claude Code 等 coding agent 的工作约定,但那是给自己团队用的。CLA 那 3 行是真的:Langfuse 要求签贡献者许可协议,机器人会在你的第一个 PR 下面提醒你签。

这道题的要点是:扫描器只能告诉你该去读哪几行,结论一定要读原文。

</details>

**练习 2:让检查器抓住编造的文件名。** 给 PR 描述再加一条检查:「How I verified」里用反引号提到的文件名(`.py`、`.md`、`.toml`、`.json` 结尾),如果既不在仓库的文件列表里、也不在 diff 改动的文件里,就报警。用 `draft_run1.md`(正文提到的第一次运行,原文在下面)、你自己的 `draft.md` 和 `good.md` 各跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex646_files.py
import re
import sys
from pathlib import Path

from part10.pr_lint import split_sections

FILE = re.compile(r"`([\w./-]+\.(?:py|md|toml|json))`")

def unknown_files(pr: str, diff: str, repo_files: set[str]) -> list[str]:
    verified = split_sections(pr).get("How I verified", "")
    known = repo_files | set(re.findall(r"^\+\+\+ b/(\S+)", diff, re.M))
    return [f for f in FILE.findall(verified) if Path(f).name not in {Path(k).name for k in known}]

if __name__ == "__main__":
    pr = Path(sys.argv[1]).read_text(encoding="utf-8")
    diff = Path("part10/samples/pr/readme.diff").read_text(encoding="utf-8")
    repo_files = {"README.md", "tinykit.py"}
    for f in unknown_files(pr, diff, repo_files):
        print(f"- 验证里提到了 {f},但仓库和 diff 里都没有这个文件")
    print("检查完")
```

<div class="line-notes">

- `FILE = re.compile(` 匹配反引号里的文件名。圆括号是捕获组,`findall` 只返回括号里的部分;`(?:...)` 是非捕获组,只用来分组。`[\w./-]+` 允许路径里有字母数字、点、斜杠和横线。
- `known = repo_files | set(re.findall(r"^\+\+\+ b/(\S+)", diff, re.M))` diff 里 `+++ b/README.md` 这种行记录了改了哪个文件,把它们抓出来。`|` 是集合的并集,≈ JS 的 `new Set([...a, ...b])`。`re.M` 让 `^` 匹配每一行的开头。
- `return [f for f in FILE.findall(verified) if Path(f).name not in {Path(k).name for k in known}]` 只比较文件名本身(`Path(f).name`),这样 `src/tinykit.py` 和 `tinykit.py` 算同一个。这是个简化,真实仓库里同名文件可能有好几个。
- `repo_files = {"README.md", "tinykit.py"}` 真实场景用 `git ls-files` 的输出;这里仓库只有两个文件,直接写死。

</div>

先把第一次运行的草稿存成 `part10/samples/pr/draft_run1.md`(只摘「How I verified」一节就够检查用,完整原文见正文描述):

```markdown
## How I verified

- Confirmed `tinykit.Server` is not exported and `tinykit.FastServer` is, by inspecting the package's `__init__.py`.
- Ran the updated snippet in a fresh Python session: `from tinykit import FastServer; server = FastServer("demo")` completes without error.
- Rendered the README locally to confirm the code block displays correctly.
```

```bash
uv run python -m part10.ex646_files part10/samples/pr/draft_run1.md
uv run python -m part10.ex646_files part10/samples/pr/draft.md
uv run python -m part10.ex646_files part10/samples/pr/good.md
```

```text
- 验证里提到了 __init__.py,但仓库和 diff 里都没有这个文件
检查完
检查完
检查完
```

第一次运行编的 `__init__.py` 被抓住了,手写的 `good.md` 没有误报。第二次运行的 `draft.md` 没提文件名,所以也没报,可它的「Rendered the README」照样是编的。规则可以一条条加,最后那道关只能是你自己。

</details>

**练习 3:Conventional Commits 检查器。** 写一个正则,判断提交信息是否符合「类型(可选范围): 说明」的格式,类型限定为 `feat fix docs test refactor chore ci perf`,冒号后面必须有空格,说明不超过 72 个字符。用下面五条测试:`docs: use FastServer in README example`、`fix(client): retry on 429 with backoff`、`Update README.md`、一条超长的 `feat: add streaming support to the server and also refactor the whole transport layer`、`docs:missing space`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex646_commit.py
import re

CONVENTIONAL = re.compile(r"^(feat|fix|docs|test|refactor|chore|ci|perf)(\([\w-]+\))?!?: \S.{0,70}$")

msgs = [
    "docs: use FastServer in README example",
    "fix(client): retry on 429 with backoff",
    "Update README.md",
    "feat: add streaming support to the server and also refactor the whole transport layer",
    "docs:missing space",
]
for m in msgs:
    print(("OK  " if CONVENTIONAL.match(m) else "BAD ") + m)
```

<div class="line-notes">

- `CONVENTIONAL = re.compile(r"^(feat|fix|docs|test|refactor|chore|ci|perf)(\([\w-]+\))?!?: \S.{0,70}$")` 从左往右读:开头是八种类型之一;`(\([\w-]+\))?` 是可选的范围,比如 `(client)`;`!?` 是可选的感叹号,表示不兼容的改动;然后必须是冒号加一个空格;`\S` 说明的第一个字符不能是空白;`.{0,70}$` 再跟最多 70 个字符直到结尾,加上前面那个字符一共不超过 71。
- `print(("OK  " if CONVENTIONAL.match(m) else "BAD ") + m)` `match` 只从字符串开头匹配,≈ JS 里正则加了 `^`。

</div>

```bash
uv run python -m part10.ex646_commit
```

```text
OK  docs: use FastServer in README example
OK  fix(client): retry on 429 with backoff
BAD Update README.md
BAD feat: add streaming support to the server and also refactor the whole transport layer
BAD docs:missing space
```

第四条格式对,但说明太长了。它其实是两件事(加流式支持、重构传输层),应该拆成两个提交,甚至两个 PR。超长的提交信息往往说明一个提交做了太多事,这个规则顺带帮你发现这一点。

</details>

**练习 4:准备你的第一个真 issue。** 从你在 SupportPilot 或 AgentOps 里踩过的某个 SDK 问题里挑一个,先在最新版本上确认它还在,再搜一下有没有人提过。按「场景、版本、最小复现、期望行为、实际行为」五段写出来,不超过 200 个英文词。先别提交,读一遍目标项目的 issue 模板,对上了再提。

<details><summary>参考答案</summary>

开放题,给一个用 tinykit 示范的写法,你的版本换成真实项目:

```markdown
### What I was doing
Following the README quickstart to start a server.

### Version
tinykit main @ 89cb29a, Python 3.12.13, macOS

### Minimal reproduction
python3 -c "from tinykit import Server"

### Expected
The README example imports and runs.

### Actual
ImportError: cannot import name 'Server' from 'tinykit'

### Notes
The module defines `FastServer`. I'm happy to send a docs PR if this should be fixed in the README.
```

几处讲究:版本写到提交号,维护者能精确定位;复现是一行命令,复制就能跑;实际行为贴的是报错原文,不是「它报错了」;最后一句说你愿意修,在 MCP SDK 这类项目里,报告人对修这个 issue 有优先权。整篇没有一句客套和解释,维护者三十秒能看完。

真实提交之前,用 `repo_health.py` 和 `ai_policy.py` 看一下目标项目,确认它收 issue、读完它的模板。验收看三点:五段齐全,复现能一键跑,长度不超过 200 词。

</details>

**验收标准**:`oss_jd.py`、`repo_health.py`、`ai_policy.py` 都跑出结果(数字会随时间变化,结构一致就行);`~/oss-practice/` 里走完 clone、加 upstream、开分支、提交、推送,`git log --oneline --all` 能看到你的提交;`good.md` 过 `pr_lint.py`,而你能逐句说出模型写的 `draft.md` 里哪几句是编的;两个真实项目的贡献规则笔记(开发环境、测试命令、提交格式、CLA、AI 规定、外部 PR 的门槛)和一份准备好的 issue 草稿。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| fork | 在 GitHub 上把别人的仓库复制一份到你名下,你在自己的副本里改,再请原项目拉取 |
| upstream | 原项目的仓库。本地仓库里一般加一个叫 upstream 的远程指向它 |
| 裸仓库(bare repository) | 只有 git 数据、没有工作文件的仓库,GitHub 服务器上存的就是这种,今天用它假装 GitHub |
| `author_association` | GitHub API 里 PR 作者和仓库的关系,如 MEMBER、CONTRIBUTOR、FIRST_TIME_CONTRIBUTOR |
| 关闭关键字 | PR 描述里的 `Fixes #42`、`Closes #42`,合并时自动关闭对应 issue |
| good first issue / help wanted | 维护者标给新人的入门 issue / 欢迎任何人来修的 issue,很多项目前者仍要先被指派 |
| CONTRIBUTING.md | 项目的贡献指南,写开发环境、测试命令、提交规范和外部贡献的规矩 |
| AI_POLICY.md | 一些项目新加的独立文件,规定贡献者使用 AI 工具时要披露什么、不能做什么 |
| CLA | Contributor License Agreement,贡献者许可协议,签了才能合并,Langfuse 用机器人提醒你签 |
| DCO | Developer Certificate of Origin,开发者原创证明,通常用提交信息里的 `Signed-off-by:` 一行声明 |
| 最小复现 | 去掉所有无关代码之后,仍然能复现问题的最短代码或命令 |
| 路过式 PR | 作者没理解项目上下文就提交的 PR,coding agent 让这类 PR 大量增加 |
| vouch | Ghostty 的担保制度:新人先申请,维护者回复 `!vouch` 后才能提 PR |
| Conventional Commits | 提交信息格式规范,`类型(范围): 说明`,如 `docs: ...`、`fix(client): ...` |

## 常见误区

**看到「26% 的 JD 提开源」就以为是硬门槛。** 关键词计数会把「开源模型」「GitHub Copilot」都算进去。逐条读完,国内真在说贡献经历的大约 17%,几乎都在加分项里。任何「X% 的 JD 要求 Y」,先问是怎么数的。

**把机器人和不公开的成员当成外部贡献者。** 第一版 `repo_health` 算出 promptfoo 46 个外部贡献 PR,其中 40 个是 renovate 和 dependabot。API 字段名字叫 `CONTRIBUTOR`,不等于它是外人。

**不读 CONTRIBUTING.md 就提 PR。** OpenAI Agents SDK 现在连文档修改都不收外部 PR;MCP SDK 的 PR 没关联已指派的 issue 会被机器人自动关掉。直接提只会浪费自己的时间。

**在 issue 下面只留一句「can I work on this?」。** MCP SDK 明说这种评论不算数。要真的参与:确认复现、问清期望行为、说说你打算怎么修。

**从自己 fork 的旧 main 开分支。** fork 不会自动跟上项目,从旧代码开分支,PR 里会冒出别人已经修好的冲突。每次都 `git fetch upstream`,从 `upstream/main` 开。

**把模型写的 PR 描述原样贴上去。** 今天的两次实验里,模型在「How I verified」里编过一个不存在的 `__init__.py`、一次没人做过的 README 渲染,最后还用第一人称替你担保「我手动验证过」。这一节必须自己写,只写真跑过的。

**用 coding agent 批量刷 PR。** 这是 2026 年最快毁掉信誉的办法。MCP 会拉黑整个组织的权限,Ghostty 会把人放进公开的黑名单,别的项目也能看到。

**以为国内网络超时是代码写错了。** `httpx.ConnectTimeout: ... The handshake operation timed out` 是访问 GitHub 时常见的网络问题,重跑或加大 `timeout`。

## 学习资料

### 文档与文章

- [开源指南:如何为开源做贡献](https://opensource.guide/zh-hans/how-to-contribute/):GitHub 出的开源贡献指南,有简体中文版,第一次贡献前通读一遍,30 分钟。
- [GitHub Docs:为项目做贡献](https://docs.github.com/zh/get-started/exploring-projects-on-github/contributing-to-a-project):fork、克隆、分支、PR 的官方操作说明,有中文。
- [GitHub Docs:将拉取请求链接到议题](https://docs.github.com/zh/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue):`Fixes #42` 这类关闭关键字的完整列表。
- [GitHub REST API:Pulls](https://docs.github.com/en/rest/pulls/pulls):`repo_health.py` 用的接口,字段说明都在这里。
- [MCP Python SDK 的 CONTRIBUTING.md](https://github.com/modelcontextprotocol/python-sdk/blob/main/CONTRIBUTING.md):今天引用最多的一份,开头「为什么要 issue 而不是 PR」那一节值得逐字读。另有 [MCP 组织级 AI 政策](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/AI_POLICY.md)。
- [OpenAI Agents SDK 的 CONTRIBUTING.md](https://github.com/openai/openai-agents-python/blob/main/CONTRIBUTING.md):不收外部 PR 的写法,以及外人能做什么。
- [Pydantic AI 贡献指南](https://pydantic.dev/docs/ai/contributing/):先交计划、可能重写你的代码,读「How we work」一节。
- [Ghostty AI_POLICY.md](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md):被很多项目参考的 AI 使用政策,5 分钟读完。
- [Mitchell Hashimoto:Contributing to Complex Projects](https://mitchellh.com/writing/contributing-to-complex-projects):怎么进入一个陌生的大代码库,英文。
- [The Register:curl 关闭漏洞赏金](https://www.theregister.com/2026/01/21/curl_ends_bug_bounty/):2026 年 1 月的报道,AI 生成的低质量报告怎么拖垮一个项目的赏金计划。
- [约定式提交 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/):Conventional Commits 规范的中文版。

### B 站视频

- isomoes《PR 不再受欢迎:AI 开源项目如何重写贡献规则》已经嵌在正文里。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EP411d7Np&autoplay=0&high_quality=1" title="如何参与开源项目?0基础入门:怎么打开GitHub?什么是issue?什么是PR?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python自动化办公社区 · 如何参与开源项目?0基础入门:怎么打开GitHub?什么是issue?什么是PR? · 13 分钟。2023 年的视频,规矩是旧的,但网页上 issue、PR 长什么样、按钮在哪,讲得很清楚。没在真实仓库上提过 PR 的话先看这个。</figcaption>
</figure>

### 其他经典视频

- GitHub 官方的《Getting started with open source contributions for beginners》已经嵌在正文里。
- Jacob Sorber,《How to Contribute to Open Source Projects on Github (pull requests)》(YouTube ID x24fOAPclL4),11 分钟,演示完整的 fork 到 PR 流程,和今天本地练的那套一一对应。

### 书籍

- Karl Fogel,《Producing Open Source Software》,O'Reilly,第二版在 [producingoss.com](https://producingoss.com/) 免费在线阅读。从维护者的视角讲开源项目怎么运作,读讲沟通和参与者的章节,你会明白维护者为什么拒掉某些 PR。没查到中文版。
- Nadia Eghbal,《Working in Public: The Making and Maintenance of Open Source Software》,[Stripe Press](https://press.stripe.com/working-in-public),2020。讲热门项目维护者被海量请求压垮的困境,写在 AI 之前,今天读起来像预言。没查到中文版。

### 开源项目与代码

- [firstcontributions/first-contributions](https://github.com/firstcontributions/first-contributions):专门给新人练习提 PR 的仓库。今天本地练完,想在真实 GitHub 上走一遍又不想打扰真项目,就用它。
- [goodfirstissue.dev](https://goodfirstissue.dev/):按语言汇总各项目的 good first issue。记得先读项目的规矩,很多仍然要先被指派。

## 自测

1. 有人说「四分之一的 AI Agent JD 都要求开源经历」。你怎么判断这个说法靠不靠谱?

<details><summary>答案</summary>

先问怎么数的。用「开源 / open source / GitHub」关键词粗筛,国内有正文的 318 条命中 83 条(26.1%),但里面有大量「了解开源模型」「GitHub Actions」「GitHub Copilot」这类和贡献无关的用法。逐条读完,真在说贡献、开源项目或开源作品的国内大约 17%,海外大约 6%,而且几乎都写在加分项里。所以它不是硬门槛,但在履历不够亮或者想拿海外远程岗时很值钱,美团甚至写了有突出开源作品「年限可适当放宽」。

</details>

2. `repo_health_v1.py` 算出 promptfoo 最近合并的 46 个 PR 全是外部贡献者写的。哪里出了问题?怎么改?

<details><summary>答案</summary>

46 个里 40 个是 renovate 和 dependabot 这类依赖升级机器人提的,它们的 `author_association` 也是 `CONTRIBUTOR`;另外,组织成员如果把成员身份设成不公开,API 里也显示成 `CONTRIBUTOR`。改法是排除 `user.type == "Bot"` 的 PR,按作者登录名去重数人头,再单独数 `FIRST_TIME_CONTRIBUTOR`,这个状态只有第一次贡献的外人才有。改完之后四个项目最近 50 个关闭的 PR 里都没有首次贡献者。

</details>

3. 你在 MCP Python SDK 的文档里发现一个错别字,想直接提 PR 修掉。按它 2026 年 10 月的贡献指南,会发生什么?应该怎么做?

<details><summary>答案</summary>

外部 PR 要同时满足两个条件才不会被关:描述里用 `Fixes #编号` 关联一个打开的 issue,并且那个 issue 被维护者指派给了你,或者带 `help wanted` 标签。直接提 PR 会被机器人打上 `missing-issue-link` 并自动关闭,错别字也不例外。正确做法是开一个 issue 指出问题,指南原话是这种情况「an issue pointing at the problem is all we need」。如果后来被指派了,PR 会在你关联 issue 后自动重新打开,期间不要 force-push。

</details>

4. 为什么本地仓库要同时有 origin 和 upstream 两个远程?开分支为什么要从 `upstream/main` 开?

<details><summary>答案</summary>

origin 是你的 fork,你只有它的写权限,代码只能推到这里;upstream 是项目本身,你从它拉最新代码。PR 的意思是「请 upstream 从我 fork 的某个分支拉代码」。fork 不会自动跟上项目,如果从 fork 的旧 main 开分支,你的改动建立在过时的代码上,PR 里会出现别人已经修好的冲突。所以每次先 `git fetch upstream`,再 `git switch -c 分支名 upstream/main`。

</details>

5. 面试题:你在团队里推广 coding agent,同事问「能不能用它给开源项目批量提 PR,刷一刷 GitHub 履历」。你怎么回答?

<details><summary>答案</summary>

答题要点:不能,而且要讲清楚为什么,不是道德说教。第一,很多项目已经明确规定,MCP 组织会拉黑屡次提交未披露 AI 内容的人,Ghostty 有公开的黑名单,OpenAI Agents SDK 干脆不收外部 PR,批量刷只会被自动关掉或被封。第二,招聘方看重的是能查验的证据,一个被关掉的路过式 PR 是负面证据,面试官点开就能看到维护者的评论。第三,给出正确用法:用 coding agent 帮你读代码、定位问题、起草修改,但人要理解每一行;「怎么验证」只写真跑过的;PR 里具体披露用了什么工具、做了什么。从一个带最小复现的好 issue 开始建立信任,比十个 PR 都管用。可以举今天的实验:模型写的 PR 描述编了一个不存在的文件,还替作者担保手动验证过。

</details>

6. 模型给你写的 PR 描述能过 `pr_lint.py` 的大部分检查,为什么还是不能直接用?

<details><summary>答案</summary>

格式检查只能保证四节都在、有关闭关键字、写了命令,抓不到内容是不是真的。今天的实验里,模型写的「How I verified」声称在本地跑过、渲染过 README(它根本没有运行环境),最后一句还用第一人称替你担保「我手动验证过」;另一次运行还声称检查了 `__init__.py`,仓库里根本没有这个文件。维护者追问一句你就答不上来。练习 2 能抓住编造的文件名,但抓不住「Rendered the README locally」这类句子。所以「How I verified」和「AI disclosure」两节必须自己写,只写真跑过的命令和真看到的结果。

</details>

## 明天预告

明天是 Day 647 · 开源影响力(二):自己的开源项目、技术写作和演讲。今天给别人的项目做贡献,发现门越来越窄;明天换个方向,把你自己做过的东西变成别人能点开看的证据:把 AgentOps 或一个小 MCP server 整理成能开源的样子(许可证、README、别把 API key 一起推上去),把一条 ADR 扩写成一篇有数据的技术文章大纲,再准备一个 15 分钟的技术分享。今天 G-Research 那条 JD 把开源、写作和演讲放在同一句里,明天就讲后两样。
