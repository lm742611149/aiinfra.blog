---
title: 'Day 55 · 选做第二作品:一天做出代码审查 Agent'
description: '做一个挂在 GitHub PR 上的审查机器人:拿到 diff、算准行号、让模型按结构化格式提意见、过滤掉误报,再作为行内评论发回去。重点不在「能评论」,而在怎么用埋 bug 的数据集证明它的意见值得看。'
pubDate: 2026-10-12
regime: none
tags: ['code-review', 'github-actions', 'diff', 'structured-output', 'evals', 'portfolio', 'agent-60']
series: 'agent-60'
day: 55
lang: 'zh'
---

## 今天要解决的问题

SupportPilot 是一个「业务流程型」Agent:读工单、查数据、走审批。招聘方看到它,会知道你能做客服、工单、知识库这一大类需求。但还有另一大类岗位关心的是「研发效能」:代码审查、测试生成、故障排查、文档生成。一个能在 PR 上自动提意见的机器人,是这一类里最容易做出来、也最容易演示的。

今天的目标是一天之内做出一个可用的最小版本,并且像毕业项目一样带上评测:

1. 用 GitHub API 取到一个 PR 的所有改动文件和 patch,把 patch 解析成「新文件第几行加了什么」。
2. 让模型对每个文件给出结构化的审查意见(行号、严重度、类别、说明、置信度),并用代码校验行号确实在本次改动里。
3. 过滤、去重、限量,把意见作为一次 review 发回 PR,每条意见挂在对应的代码行上。
4. 写一个 GitHub Actions workflow,PR 一打开就自动跑。
5. 造一个「埋 bug」评测集,量出召回率和误报率,知道这个机器人的意见到底有几成值得看。

预计用时 6–8 小时,时间紧可以只做前四步,评测留到求职期间补上。前置是 Day 6(结构化输出)、Day 9(Agent 循环)、Day 13(workflow 还是 agent)、Day 31–32(测试集与 LLM 评审)。这是选做内容,跳过它不影响后面的求职部分。

## 先决定:这是 workflow 还是 agent

Day 13 讲过,能用固定流程解决的就别上 Agent。代码审查的最小版本是一个很标准的 prompt chaining:

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="代码审查机器人的流水线">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <rect x="16" y="70" width="92" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="28" y="90" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">取 diff</text>
  <text x="28" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GitHub API</text>
  <rect x="130" y="70" width="92" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="142" y="90" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">解析分块</text>
  <text x="142" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">算行号</text>
  <rect x="244" y="70" width="92" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="256" y="90" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">逐文件审</text>
  <text x="256" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">LLM·JSON</text>
  <rect x="358" y="70" width="92" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="370" y="90" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">校验过滤</text>
  <text x="370" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">行号·置信</text>
  <rect x="472" y="70" width="92" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="484" y="90" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">发 review</text>
  <text x="484" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">行内评论</text>
  <line x1="108" y1="92" x2="130" y2="92" stroke="var(--ink-faint)"/>
  <line x1="222" y1="92" x2="244" y2="92" stroke="var(--ink-faint)"/>
  <line x1="336" y1="92" x2="358" y2="92" stroke="var(--ink-faint)"/>
  <line x1="450" y1="92" x2="472" y2="92" stroke="var(--ink-faint)"/>
  <path d="M290 70 C 290 30, 400 30, 400 50" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
  <text x="300" y="34" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">升级版:给它 read_file / grep 工具</text>
  <text x="16" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">只有蓝色那一步调模型;其余全是确定性代码,误报主要靠「校验过滤」那一步压下去</text>
</svg>
<figcaption>最小版本是一条五步流水线,只有一步用模型。等它跑稳了,再把「逐文件审」升级成能自己翻代码上下文的 Agent。</figcaption>
</figure>

只看 diff 的局限很明显:一个函数改了签名,调用它的地方没在 diff 里,模型看不到;一个变量在别处被加了锁,模型也不知道。所以升级版会给模型两个工具,让它在需要时自己去读文件、搜代码。但先把不需要 Agent 的版本做对,行号、过滤、发评论这些脏活在两个版本里是一样的。

## 第一步:取 diff,把行号算准

GitHub 的「列出 PR 文件」接口会返回每个改动文件的 `filename`、`status`(added/modified/removed/renamed)和 `patch`,`patch` 就是统一 diff 格式的文本。新建一个仓库 `reviewbot/`:

```bash
mkdir reviewbot && cd reviewbot
uv init --python 3.12
uv add httpx openai pydantic
```

```python
# reviewbot/github_api.py
import os

import httpx

API = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def list_pr_files(repo: str, pr: int) -> list[dict]:
    """返回 PR 的改动文件列表,自动翻页。超大 PR 里单文件 patch 可能被 GitHub 省略,此时没有 patch 字段。"""
    files, page = [], 1
    with httpx.Client(headers=HEADERS, timeout=30) as c:
        while True:
            r = c.get(f"{API}/repos/{repo}/pulls/{pr}/files", params={"per_page": 100, "page": page})
            r.raise_for_status()
            batch = r.json()
            files.extend(batch)
            if len(batch) < 100:
                return files
            page += 1


def get_pr(repo: str, pr: int) -> dict:
    with httpx.Client(headers=HEADERS, timeout=30) as c:
        r = c.get(f"{API}/repos/{repo}/pulls/{pr}")
        r.raise_for_status()
        return r.json()


def post_review(repo: str, pr: int, commit_id: str, body: str, comments: list[dict]) -> dict:
    """一次性发一个 review,里面带多条行内评论。event=COMMENT 表示只评论不批准也不拒绝。"""
    payload = {"commit_id": commit_id, "body": body, "event": "COMMENT", "comments": comments}
    with httpx.Client(headers=HEADERS, timeout=30) as c:
        r = c.post(f"{API}/repos/{repo}/pulls/{pr}/reviews", json=payload)
        r.raise_for_status()
        return r.json()
```

为什么一次发一个 review 而不是一条条发评论?一条条发,PR 作者会收到十几封通知邮件,第二次就会把你的机器人静音。

接下来是今天最容易出错的地方:行号。行内评论要指定「新文件的第几行」,而 patch 里的行号要自己算。一段 patch 长这样:

```text
@@ -40,7 +40,9 @@ def charge(customer, amount):
     if amount <= 0:
         raise ValueError("amount must be positive")
-    invoice = create_invoice(customer, amount)
+    invoice = create_invoice(customer, amount)
+    if customer.balance < amount:
+        invoice.status = "pending"
     send_email(customer.email, invoice)
```

`@@ -40,7 +40,9 @@` 的意思是:旧文件从第 40 行开始的 7 行,变成了新文件从第 40 行开始的 9 行。往下逐行走:空格开头是上下文(新旧都有,新行号加 1),`+` 开头是新增(只有新文件有,新行号加 1),`-` 开头是删除(只有旧文件有,新行号不变)。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="patch 行与新文件行号的对应">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">patch 行</text>
  <text x="460" y="28" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">新文件行号</text>
  <text x="20" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">@@ -40,7 +40,9 @@</text>
  <text x="460" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">起点 40</text>
  <text x="20" y="78" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">  if amount &lt;= 0:</text>
  <text x="460" y="78" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">40</text>
  <text x="20" y="100" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">      raise ValueError(...)</text>
  <text x="460" y="100" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">41</text>
  <rect x="14" y="108" width="420" height="20" fill="var(--rule)" opacity="0.35"/>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">- invoice = create_invoice(...)</text>
  <text x="460" y="122" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">无(不计数)</text>
  <rect x="14" y="130" width="420" height="20" fill="var(--mem-wash)"/>
  <text x="20" y="144" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">+ invoice = create_invoice(...)</text>
  <text x="460" y="144" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">42 可评论</text>
  <rect x="14" y="152" width="420" height="20" fill="var(--mem-wash)"/>
  <text x="20" y="166" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">+ if customer.balance &lt; amount:</text>
  <text x="460" y="166" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">43 可评论</text>
  <rect x="14" y="174" width="420" height="20" fill="var(--mem-wash)"/>
  <text x="20" y="188" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">+     invoice.status = "pending"</text>
  <text x="460" y="188" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">44 可评论</text>
  <text x="20" y="210" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">  send_email(...)</text>
  <text x="460" y="210" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">45</text>
</svg>
<figcaption>删除行不占新文件行号。我第一版把 `-` 行也加了 1,结果所有评论都往下错了几行,挂在不相干的代码上。</figcaption>
</figure>

```python
# reviewbot/diff.py
import re
from dataclasses import dataclass

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class DiffLine:
    kind: str           # "+" 新增,"-" 删除," " 上下文
    text: str
    new_no: int | None  # 新文件行号,删除行为 None


def parse_patch(patch: str) -> list[DiffLine]:
    lines: list[DiffLine] = []
    new_no = 0
    for raw in patch.splitlines():
        m = HUNK_RE.match(raw)
        if m:
            new_no = int(m.group(3))
            lines.append(DiffLine("@", raw, None))
            continue
        if raw.startswith("\\"):  # "\ No newline at end of file"
            continue
        kind, text = (raw[:1] or " "), raw[1:]
        if kind == "-":
            lines.append(DiffLine("-", text, None))
        else:
            lines.append(DiffLine(kind, text, new_no))
            new_no += 1
    return lines


def render_for_model(path: str, lines: list[DiffLine]) -> str:
    """给模型看的版本:每个新文件行前面标上行号,模型引用行号时直接照抄。"""
    out = [f"文件:{path}"]
    for ln in lines:
        if ln.kind == "@":
            out.append(ln.text)
        elif ln.kind == "-":
            out.append(f"      - {ln.text}")
        else:
            out.append(f"L{ln.new_no:<5}{ln.kind} {ln.text}")
    return "\n".join(out)


def added_lines(lines: list[DiffLine]) -> set[int]:
    return {ln.new_no for ln in lines if ln.kind == "+" and ln.new_no is not None}
```

`render_for_model` 是个小技巧:与其让模型自己数行号(它数不准),不如把行号直接印在每行前面,让它抄。这一招对准确率的提升非常明显。

## 第二步:让模型给结构化意见

prompt 的关键是告诉模型「什么值得说、什么不值得说」。代码审查机器人被人嫌弃,十有八九是因为话太多:变量命名、加个注释、这里可以用列表推导式……这些意见单看都对,堆在一起就是噪音,作者很快学会忽略所有评论,包括真正的 bug。

```python
# reviewbot/review.py
import json
import os

from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.getenv("LLM_MODEL", "deepseek-v4-pro")

SYSTEM = """你是一位资深代码审查者,只指出会导致错误行为、安全问题、数据损坏或明显性能问题的地方。
不要评论:命名风格、格式、注释多少、「可以更简洁」之类的写法偏好、你不确定的猜测。
如果这个文件没有值得指出的问题,返回空列表,这是完全正常的结果。

只能评论以 `+` 标记的新增行,行号必须照抄行首的 L 后面的数字。

输出 JSON:{"findings": [{"line": 整数, "severity": "high|medium|low",
"category": "bug|security|performance|concurrency|error_handling",
"comment": "一到三句中文,说清问题和后果", "suggestion": "可选,修改建议或代码",
"confidence": 0 到 1 之间的小数}]}"""


class Finding(BaseModel):
    line: int
    severity: str = Field(pattern="^(high|medium|low)$")
    category: str
    comment: str
    suggestion: str = ""
    confidence: float = Field(ge=0, le=1)


class Findings(BaseModel):
    findings: list[Finding]


def review_file(rendered_diff: str, pr_title: str, pr_body: str) -> list[Finding]:
    user = f"PR 标题:{pr_title}\nPR 描述:{pr_body[:1500]}\n\n<diff>\n{rendered_diff}\n</diff>"
    for attempt in range(2):
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        try:
            return Findings.model_validate(json.loads(resp.choices[0].message.content)).findings
        except (json.JSONDecodeError, ValidationError):
            if attempt == 1:
                return []
    return []
```

PR 描述放进去有两个原因:模型能知道作者的意图(「这次只是重构,不改行为」),另外描述里有时会写「已知问题,下个 PR 修」,模型就不会重复提。但 PR 描述是作者写的、对机器人来说是不可信输入,所以截断长度,并且 Day 53 的道理同样适用:这个机器人除了发评论没有别的能力,被注入了最多是发几条奇怪的评论,风险可控。

## 第三步:过滤,这一步决定机器人有没有人用

模型返回的意见不能直接发。过滤规则全部是确定性代码:

```python
# reviewbot/main.py
import os
import sys

from diff import added_lines, parse_patch, render_for_model
from github_api import get_pr, list_pr_files, post_review
from review import review_file

SKIP_SUFFIXES = (".lock", ".min.js", ".svg", ".png", ".jpg", ".snap", ".pb.go")
SKIP_NAMES = {"package-lock.json", "uv.lock", "poetry.lock", "pnpm-lock.yaml", "go.sum"}
MAX_PATCH_CHARS = 24_000      # 单文件 patch 太大就跳过,通常是生成代码或大规模重命名
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.6"))
MAX_COMMENTS = int(os.getenv("MAX_COMMENTS", "8"))
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
FENCE = "`" * 3  # Markdown 代码围栏,评论里的建议代码用它包起来


def should_skip(f: dict) -> bool:
    name = f["filename"]
    return (
        f["status"] == "removed"
        or "patch" not in f
        or len(f["patch"]) > MAX_PATCH_CHARS
        or name.endswith(SKIP_SUFFIXES)
        or name.rsplit("/", 1)[-1] in SKIP_NAMES
    )


def run(repo: str, pr_number: int, dry_run: bool = False) -> list[dict]:
    pr = get_pr(repo, pr_number)
    candidates = []
    for f in list_pr_files(repo, pr_number):
        if should_skip(f):
            continue
        lines = parse_patch(f["patch"])
        valid_lines = added_lines(lines)
        for fd in review_file(render_for_model(f["filename"], lines), pr["title"], pr.get("body") or ""):
            if fd.line not in valid_lines:
                continue  # 行号不在本次新增行里:要么模型抄错了,要么在评论旧代码
            if fd.confidence < MIN_CONFIDENCE or fd.severity == "low":
                continue
            candidates.append((f["filename"], fd))

    # 同一行只留一条;按严重度和置信度排序后截断
    seen, comments = set(), []
    for path, fd in sorted(candidates, key=lambda x: (SEVERITY_RANK[x[1].severity], -x[1].confidence)):
        if (path, fd.line) in seen:
            continue
        seen.add((path, fd.line))
        body = f"**[{fd.severity}/{fd.category}]** {fd.comment}"
        if fd.suggestion:
            body += f"\n\n建议:\n{FENCE}\n{fd.suggestion}\n{FENCE}"
        comments.append({"path": path, "line": fd.line, "side": "RIGHT", "body": body})
        if len(comments) >= MAX_COMMENTS:
            break

    summary = f"自动审查:看了改动,提出 {len(comments)} 条意见(只报 medium 及以上、置信度 ≥ {MIN_CONFIDENCE})。"
    if not dry_run and comments:
        post_review(repo, pr_number, pr["head"]["sha"], summary, comments)
    return comments


if __name__ == "__main__":
    repo, number = sys.argv[1], int(sys.argv[2])
    for c in run(repo, number, dry_run="--dry-run" in sys.argv):
        print(f"{c['path']}:{c['line']}  {c['body'][:80]}")
```

几个阈值(置信度 0.6、最多 8 条、不报 low)是起点,不是答案。后面的评测会告诉你该怎么调。我的经验是宁可漏报也不要误报:一个机器人如果十条意见里有七条是对的,大家会认真看;如果十条里只有三条对,大家会把它关掉,剩下那三条也就白提了。

发评论前用 `--dry-run` 在终端里看一眼输出,确认行号对得上,再真正发。

## 第四步:挂到 GitHub Actions 上

```yaml
# .github/workflows/review.yml(放在被审查的仓库里)
name: ai-review
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: <你的用户名>/reviewbot
          path: reviewbot
      - uses: astral-sh/setup-uv@v6
      - name: Run review
        working-directory: reviewbot
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          LLM_BASE_URL: ${{ vars.LLM_BASE_URL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: deepseek-v4-pro
        run: uv run python main.py ${{ github.repository }} ${{ github.event.pull_request.number }}
```

在仓库 Settings 的 Secrets 里加 `LLM_API_KEY`,在 Variables 里加 `LLM_BASE_URL`(用 DeepSeek 就填它的 OpenAI 兼容地址 `api.deepseek.com`,前面加 https 协议头)。`GITHUB_TOKEN` 是 Actions 自动提供的,`permissions` 里给了它写 PR 评论的权限。

这里有一个安全上的坑必须知道:来自 fork 的 PR 触发 `pull_request` 事件时拿不到仓库的 secrets,机器人会跑失败。网上有人会建议改成 `pull_request_target`,它能拿到 secrets。但 `pull_request_target` 如果同时 checkout 了 PR 的代码并执行,等于让任何陌生人提交的代码带着你的密钥运行,这是 GitHub Actions 里最经典的漏洞之一。我们的机器人只通过 API 读 diff 文本,不执行 PR 里的代码,理论上可以用,但除非你完全理解其中的风险,开源仓库对 fork 的 PR 就先不审,或者由维护者手动触发。

## 第五步:评测,用埋进去的 bug 量召回

到这里你已经有一个能用的机器人了。但「能用」和「好用」之间,隔着一份评测报告。代码审查很适合做评测,因为可以人为造出「正确答案」:找一些干净的代码改动,往里面故意埋一个已知的 bug,看机器人能不能在那一行附近指出来。

```python
# reviewbot/evals/cases.py
"""每条用例:一段干净的改动 + 一个埋进去的 bug。bug 所在的新文件行号就是标准答案。"""

CASES = [
    {
        "id": "off-by-one-01",
        "path": "billing/proration.py",
        "patch": """@@ -10,6 +10,9 @@ def prorate(amount, start, end, period_days):
     if end <= start:
         return 0
     used = (end - start).days
+    # 按天折算,period_days 是整个计费周期天数
+    for d in range(1, used):
+        accrue(d)
     return round(amount * used / period_days, 2)""",
        "bug_line": 14,
        "bug_type": "bug",
    },
    {
        "id": "missing-await-01",
        "path": "app/handlers.py",
        "patch": """@@ -22,4 +22,6 @@ async def handle(req):
     user = await load_user(req.user_id)
+    audit = write_audit_log(user.id, "login")
+    await notify(user)
     return {"ok": True}""",
        "bug_line": 23,
        "bug_type": "bug",
    },
    {
        "id": "sql-injection-01",
        "path": "app/search.py",
        "patch": """@@ -5,3 +5,5 @@ def search(conn, keyword):
-    return conn.execute("SELECT * FROM docs WHERE title LIKE ?", (f"%{keyword}%",))
+    sql = f"SELECT * FROM docs WHERE title LIKE '%{keyword}%'"
+    return conn.execute(sql)""",
        "bug_line": 5,
        "bug_type": "security",
    },
    # ……照这个格式扩到 30 条以上,覆盖:边界条件、空值、资源未释放、并发竞态、
    # 异常被吞、权限检查遗漏、N+1 查询、时区处理。另加 10 条「完全干净」的改动测误报。
]
```

上面三条:第一条 `range(1, used)` 少算了一天(假设业务语义是包含两端,这一点要在 PR 描述里写清楚,否则它就不算 bug);第二条 `write_audit_log` 如果是协程却没有 await,审计日志根本没写;第三条把参数化查询改成了字符串拼接。另外 10 条干净的改动,机器人只要发了任何 medium 以上的意见就算误报。

```python
# reviewbot/evals/run_eval.py
from diff import added_lines, parse_patch, render_for_model
from evals.cases import CASES
from review import review_file

TOLERANCE = 2  # 指出的行和埋 bug 的行相差 2 行以内都算命中


def main(min_conf: float = 0.6) -> None:
    hit = miss = fp_clean = 0
    total_comments = 0
    for case in CASES:
        lines = parse_patch(case["patch"])
        valid = added_lines(lines)
        findings = [
            f for f in review_file(render_for_model(case["path"], lines), "eval", "")
            if f.line in valid and f.confidence >= min_conf and f.severity != "low"
        ]
        total_comments += len(findings)
        if case.get("bug_line") is None:  # 干净用例
            fp_clean += bool(findings)
            continue
        if any(abs(f.line - case["bug_line"]) <= TOLERANCE for f in findings):
            hit += 1
        else:
            miss += 1
            print(f"漏报 {case['id']}")
    n_bug = hit + miss
    n_clean = sum(1 for c in CASES if c.get("bug_line") is None)
    print(f"召回 {hit}/{n_bug}")
    if n_clean:
        print(f"干净用例误报 {fp_clean}/{n_clean}")
    print(f"平均每条用例意见数 {total_comments / max(len(CASES), 1):.2f}")


if __name__ == "__main__":
    main()
```

召回和误报只是两个数,还有一个指标比它们都重要:**有埋 bug 的用例里,除了命中 bug 的那条,机器人还额外说了几条?** 这些额外意见里一部分可能是对的,但大部分是噪音。人工看一遍,把额外意见标成「有用 / 没用」,算出「有用率」(precision 的近似)。字节跳动发表的 BitsAI-CR 论文里,他们在公司内部规模化部署后报告的审查意见精确率是 75%,并且用了一个很聪明的线上指标叫 Outdated Rate:机器人评论过的那一行,后来有没有被作者改掉。改掉了说明意见被采纳。你的机器人如果装在自己常用的仓库里,也可以统计这个数。

把阈值从 0.5 扫到 0.9,每个阈值记一次召回和有用率,你会看到一条典型的权衡曲线:阈值越高,意见越少越准,但漏得越多。挑一个你能接受的点,把这张表放进 README,这就是这个作品最有说服力的部分。

| 置信度阈值 | 召回 | 干净用例误报 | 平均意见数 | 有用率(人工) |
| --- | --- | --- | --- | --- |
| 0.5 | | | | |
| 0.6 | | | | |
| 0.7 | | | | |
| 0.8 | | | | |

## 升级成 Agent:让它自己翻代码

只看 diff 漏掉的那些问题,大多是因为缺上下文。升级办法是把 Day 9 的 Agent 循环拿过来,给它两个只读工具:

```python
# reviewbot/agent_tools.py
import subprocess
from pathlib import Path

REPO_ROOT = Path("target_repo")  # Actions 里额外 checkout 被审查仓库的 PR head 到这个目录


def read_file(path: str, start: int = 1, end: int = 200) -> str:
    """读取仓库里某个文件的指定行范围,最多 200 行。"""
    p = (REPO_ROOT / path).resolve()
    if not p.is_relative_to(REPO_ROOT.resolve()) or not p.is_file():
        return "文件不存在"
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    end = min(end, start + 199, len(lines))
    return "\n".join(f"{i}: {lines[i - 1]}" for i in range(max(start, 1), end + 1))


def grep(pattern: str, max_results: int = 30) -> str:
    """在仓库里搜索固定字符串(不是正则),返回 文件:行号:内容。"""
    out = subprocess.run(
        ["grep", "-rnF", "--max-count=5", pattern, "."],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=20,
    ).stdout.splitlines()
    return "\n".join(out[:max_results]) or "没有结果"
```

`is_relative_to` 那一行防止模型(或被注入的模型)用 `../../` 读到仓库外面的文件,比如 runner 上的环境配置。`grep` 用 `-F` 按固定字符串搜,并且用参数列表而不是拼接 shell 命令,避免命令注入。注意这里 checkout 了 PR 的代码,但只读不执行,前面说的 `pull_request_target` 风险依然要避开。

给 Agent 设一个步数上限(比如每个文件最多 6 次工具调用),然后用同一个评测集比一比:召回涨了多少,成本涨了多少。按我的经验,跨文件的问题(改了函数签名没改调用方)召回会有明显提升,但每个 PR 的成本可能翻两三倍。值不值得,看你的评测数字,这就是一个很好的面试话题。

## 它和 Claude Code、Codex、CodeRabbit 是什么关系

你可能会问:市面上已经有 Claude Code 的 GitHub Action、OpenAI Codex 的代码审查、CodeRabbit、开源的 PR-Agent,我自己做一个有什么意义?

作为产品,确实没必要和它们竞争。作为作品,意义在三点。第一,你能讲清楚这类工具内部的每一环:行号怎么算、误报怎么控、评测怎么做,这些是用现成工具的人讲不出来的。第二,很多公司的代码在内网 GitLab 上,不能把代码发给外部 SaaS,需要有人基于自部署或国内模型搭一套,这正是 JD 里「AI 研发效能」方向的典型需求。第三,你有一份评测报告,知道它的边界在哪。

GitLab 的版本只需要换掉 `github_api.py`:取改动用 MR 的 changes(或 diffs)接口,发行内评论用 discussions 接口,`position` 里要带上 `base_sha`、`start_sha`、`head_sha`、`new_path`、`new_line`。三个 sha 从 MR 详情的 `diff_refs` 里取。其余代码一行不用改,这也是把平台相关代码隔离在一个文件里的好处。

## 反过来:用 Coding Agent 写代码,你也得会审它

今天的机器人审的是人写的代码。现实里越来越多的代码是 Claude Code、Codex、Cursor 这类 Coding Agent 写的,而招聘方已经把这件事写进了 JD:在一份 880 条 Agent 岗位 JD 的调研里,国内有正文的 334 条中约两成(21%)点名要求熟练使用 Coding Agent,海外是 15%,有的写得很直接,「熟练使用 Codex/Claude Code/Cursor 并把控生成代码质量」。后半句才是重点:会用不稀奇,能看出它哪里写错了才是本事。

Coding Agent 的失败有很固定的几种形状,你在做 SupportPilot 时多半已经见过其中几种:

- **上下文丢失**:会话一长,它忘了你一开始定下的约定,比如「所有工具都不接收 customer_id」,在第 40 轮改代码时又给新工具加上了这个参数。Day 53 的安全设计就这样被悄悄破坏。
- **工具误用**:跑错命令、改错文件、在错误的目录执行迁移,或者为了让命令成功而加上 `--force`。
- **多轮偏移**:你让它修一个 bug,它顺手重构了三个文件,改着改着离原始需求越来越远,最后的 diff 里真正和 bug 有关的只有两行。
- **测试作弊**:测试过不了,它改的是测试而不是代码,比如放宽断言、加上 `skip`、把期望值改成实际输出。这是最危险的一种,因为 CI 是绿的。
- **幻觉 API**:调用不存在的库函数或参数,常见于版本更新快的库(LangGraph、MCP SDK 这类),它记住的是旧版本的写法。
- **吞掉错误**:为了让流程跑通,加一个宽泛的 `except Exception: pass`,问题从「报错」变成了「静默出错」。

对应的审查清单,我每次合并 Coding Agent 的改动前都过一遍:

1. 先看 diff 的规模和范围,超出任务范围的改动单独拎出来问「为什么改这里」。
2. 测试文件有没有被改。被改了就逐行看,断言变松了、期望值变了、多了 skip,一律视为可疑。
3. 新增的依赖、新增的外部调用、新增的文件读写和网络访问,逐个确认。
4. 搜一遍 `except`、`pass`、`# TODO`、`noqa`、`type: ignore`,看有没有被用来掩盖问题。
5. 和项目约定对一遍:安全约定(身份不由模型传入)、命名、目录结构。把这些约定写进仓库根目录的 `CLAUDE.md` 或 `AGENTS.md`,Coding Agent 每次会话开始会读,能减少一大半上下文丢失。
6. 自己把关键路径跑一遍,不只看 CI。

工作方式上也有几条能显著减少返工:先让它出计划再写代码,一次只做一个小改动并及时提交,让它先写失败的测试再写实现,以及用一个新会话(或者今天做的这个机器人)去审查它的产出,而不是让写代码的同一个会话自己审自己。最后这一条和 Day 26 讲的上下文隔离是一个道理:写的人天然倾向于认为自己写的是对的。

这一节值得写进你的简历和面试回答:「我用 Coding Agent 提高开发效率,同时有一套审查流程控制它的产出质量」,比单说「熟练使用 Cursor」有说服力得多。

## 动手练习

**步骤**

1. 建 `reviewbot/` 仓库,写 `github_api.py`、`diff.py`、`review.py`、`main.py`。
2. 在自己的一个练习仓库里开一个 PR,故意写两个 bug,本地设好环境变量后跑 `uv run python main.py <owner/repo> <PR号> --dry-run`,核对每条意见的行号。
3. 去掉 `--dry-run` 真正发一次,在 GitHub 页面上确认评论挂在了正确的行。
4. 把 workflow 放进练习仓库,再开一个 PR,确认自动触发。
5. 把评测集扩到至少 30 条埋 bug 用例 + 10 条干净用例,跑出阈值扫描表,人工标注额外意见的有用率。
6. (可选)实现 Agent 升级版,用同一评测集对比召回和成本。
7. 按 Day 54 的方法给它写 README,第一屏放一张 PR 页面上的评论截图和阈值扫描表。

**验收标准**

- 所有发出的评论都挂在正确的新增行上,没有一条错位。
- 一个只改了 lock 文件和图片的 PR,机器人不发任何评论。
- 评测报告里有召回、干净用例误报、平均意见数、有用率四个数,以及你最终选的阈值和理由。
- 能说出 `pull_request` 和 `pull_request_target` 的区别,以及你的配置为什么是安全的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PR / MR | Pull Request(GitHub)/ Merge Request(GitLab),请求把一个分支的改动合入主干 |
| 统一 diff(unified diff) | `@@ -a,b +c,d @@` 开头的差异格式,`+` 新增、`-` 删除、空格为上下文 |
| hunk | diff 里一个 `@@` 开头的连续改动块 |
| 行内评论 | 挂在 diff 某一行上的评论,需要指定文件路径和行号 |
| review | GitHub 上一次完整的审查,可包含多条行内评论和一段总评 |
| 召回(recall) | 埋进去的 bug 有多少被找到了 |
| 有用率 | 机器人发出的意见里有多少是人认可的,近似精确率 |
| Outdated Rate | BitsAI-CR 论文提出的线上指标:被评论的代码行后来被作者修改的比例 |
| pull_request_target | 以目标仓库权限运行的 Actions 事件,能拿到 secrets,与执行 PR 代码结合时很危险 |

## 常见误区

**让模型自己数行号。** 它会数错,而且错得很稳定。把行号印在每行前面让它抄,再用代码校验必须在新增行集合里。

**意见越多显得越认真。** 代码审查机器人的生死取决于信噪比。宁可每个 PR 只说一两句有用的话,也不要说十句废话。

**用「它说得都挺有道理」代替评测。** 模型生成的审查意见几乎总是读起来有道理,所以更需要埋 bug 的客观测试和人工标注的有用率。

**评论风格、命名、格式。** 这些交给 linter 和 formatter,它们是确定性的、零成本的、不会误报的。模型只做 linter 做不了的事。

**为了支持 fork 的 PR 随手改成 pull_request_target。** 这是真实世界里很多仓库被盗取 secrets 的原因。

**把整个 PR 一次塞给模型。** 大 PR 会超出上下文或者让模型注意力分散,按文件审,超大文件跳过,结果更好也更便宜。

## 学习资料

### 文档与文章

- [GitHub REST API · Pull requests](https://docs.github.com/en/rest/pulls/pulls):「List pull requests files」接口返回的 `patch` 字段说明,30 分钟。
- [GitHub REST API · Pull request reviews](https://docs.github.com/en/rest/pulls/reviews):「Create a review」接口,`comments` 数组里 `path`、`line`、`side` 的含义。
- [GitLab API · Merge requests](https://docs.gitlab.com/api/merge_requests/) 与 [Discussions](https://docs.gitlab.com/api/discussions/):做 GitLab 版本时看 `position` 参数那一节。
- [BitsAI-CR: Automated Code Review via LLM in Practice](https://arxiv.org/abs/2501.15134):字节跳动的工业实践论文,两阶段(先检测再过滤)和 Outdated Rate 是今天最值得借鉴的两点,读摘要和方法部分 40 分钟。
- [Claude Code · GitHub Actions](https://code.claude.com/docs/en/github-actions):看现成的 Agent 型审查是怎么配置的,和你的版本对比。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EkAKeJEUU&autoplay=0&high_quality=1" title="字节内部codeReview工具-BitsAICR:基于LLM的自动化代码审查实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI论文小小编 · 字节内部codeReview工具-BitsAICR:基于LLM的自动化代码审查实践 · 22 分钟,论文的中文讲解,重点听规则体系和过滤器怎么降误报。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RfaX6sESp&autoplay=0&high_quality=1" title="【Code Review】AI时代的CR还有意义么?一起看一个模板解析库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【Code Review】AI时代的CR还有意义么?一起看一个模板解析库 · 16 分钟,看一位资深工程师人工审查时关注什么,对照想想你的 prompt 里该让模型关注什么。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wou7i3sLIRA" title="How to build your own AI Code Review Agent from scratch!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeRabbit · How to build your own AI Code Review Agent from scratch! · 做这类产品的公司讲从零搭一个审查 Agent,看他们怎么处理上下文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/R1MvBwoyHxw" title="Claude Code GitHub Action: Automated PR Reviews Setup" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Gray Cat · Claude Code GitHub Action: Automated PR Reviews Setup · 现成方案的配置演示,看完你会更清楚自己的版本差在哪、强在哪。</figcaption>
</figure>

### 书籍

- Titus Winters 等《Software Engineering at Google》(O'Reilly, 2020):第 9 章 Code Review,讲 Google 的人工审查到底在审什么(正确性、可理解性、一致性),是你写审查 prompt 的最好参照,[在线免费读](https://abseil.io/resources/swe-book/html/ch09.html),40 分钟。

### 开源项目与代码

- [qodo-ai/pr-agent](https://github.com/qodo-ai/pr-agent):开源的 PR 审查 Agent,支持 GitHub 和 GitLab,看它怎么压缩大 PR、怎么组织 prompt。
- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action):Claude Code 的 GitHub Action,看 Agent 型审查的权限和触发设计。

## 自测

1. patch `@@ -100,4 +102,6 @@` 下面依次是:上下文、删除、新增、新增、上下文。两个新增行在新文件里是第几行?

<details><summary>答案</summary>

新文件起点 102。第一行上下文是 102;删除行不占新行号;第一个新增是 103,第二个新增是 104;最后的上下文是 105。

</details>

2. 为什么要把所有行内评论合并成一次 review 发出,而不是一条条调用评论接口?

<details><summary>答案</summary>

一条条发会给 PR 作者和订阅者触发很多条通知,体验很差,也更容易撞到 API 频率限制。一次 review 只产生一次通知,还能附一段总评,并且所有评论原子地出现。

</details>

3. 你的机器人在 40 条用例上召回 70%,但团队试用一周后反馈「太吵了」。你会看哪个指标、调哪些参数?

<details><summary>答案</summary>

看平均意见数和有用率(额外意见里人认可的比例),线上可以看 Outdated Rate。调整方向:提高置信度阈值、只报 high 和 medium、降低每个 PR 的评论上限、在 prompt 里更明确地列出不要评论的类别,并把风格类问题交给 linter。调完用评测集确认召回没有掉得太多。

</details>

4. 升级版给模型提供 `read_file` 工具时,为什么要检查路径在仓库根目录内?

<details><summary>答案</summary>

防止路径穿越。PR 内容和描述是不可信输入,模型可能被诱导读取 `../../` 之类的路径,访问到 runner 上仓库之外的文件,比如环境配置或凭据,再通过评论内容外带出去。

</details>

5. (面试题)「市面上已经有很多 AI 代码审查工具,你为什么还要自己做一个?它比现成的好在哪?」

<details><summary>答案</summary>

不要硬说比现成产品好。可以这样答:做它是为了把这类系统的关键环节吃透,包括 diff 行号映射、结构化输出加代码校验、误报控制和评测方法;评测上我用埋 bug 数据集量召回和误报,并扫描阈值选出了工作点,这些在用现成工具时是看不到的;另外很多公司代码在内网,需要基于自部署或国内模型的方案,我的实现把平台相关代码隔离在一个文件里,换 GitLab 只改一处。最后给出你的评测数字。

</details>

## 明天预告

Day 56 · 简历:AI Agent 岗的简历怎么写。两个作品都有了,接下来五天全部用来找工作。明天对照真实 JD 的关键词改简历:项目经历怎么用「问题、方案、数据」的结构写,原来的后端或测试工作经历怎么诚实地往 AI 方向改写,中英文两个版本怎么准备,GitHub 和博客链接放在哪里最容易被点开。
