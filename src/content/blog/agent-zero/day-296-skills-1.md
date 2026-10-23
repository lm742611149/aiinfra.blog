---
title: 'Day 296 · Agent Skills(一):Skill 是什么,写一个退款 skill'
description: '提示词、业务规则越写越长,全塞进 system prompt 每次请求都要付钱。Agent Skills 把「怎么做某件事」装进一个带 SKILL.md 的文件夹,平时只露一行目录。今天先让模型心算退款金额,看它直接报数 12 题只对 3 题,再给云簿写一个带参考文件和两个脚本的 refund-policy skill,配一个自己写的格式检查器。'
pubDate: 2026-10-23
regime: none
tags: ['agent-skills', 'skill-md', 'context-engineering', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 296
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 291](/blog/agent-zero/day-291-text-to-sql-1/) 到 [Day 295](/blog/agent-zero/day-295-text-to-sql-4/) 做了一个问数 Agent:给模型一份库说明书,用三道闸把 SQL 管成只读、跑得完,接成能自修的循环,用 10 道题评测,最后讲了表多到几十上百张怎么办。那一周反复出现同一个麻烦:说明书越写越长。5 张表的时候 2577 个字符,68 张表是 12484 个字符,每个问题都得带着它走一遍。

今天换一个角度想同一件事。业务规则也一样:退款怎么算、发票抬头怎么改、两步验证怎么关,每一条都是一段说明书。全塞进 system prompt,不管客户今天问的是什么,这些字都要付钱。**有没有办法让说明书平时不出场,用到才翻开?** 这就是 Anthropic 在 2025 年 10 月提出、同年 12 月作为开放标准发布的 Agent Skills。今天讲它是什么、怎么写;明天讲怎么让它真的跑起来。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清 Skill 是一个什么样的文件夹,`SKILL.md` 由哪两部分组成,三层加载里每一层什么时候进上下文。
2. 对着开放标准的字段规则,写出合规的 `name` 和能让模型选对的 `description`。
3. 给云簿写一个 `refund-policy` skill:正文、参考文件、两个只读数据库的脚本,并说清为什么金额要交给脚本算。
4. 写一个 `skill_check.py`,自动检查一个 skill 目录合不合规范,并用五种故意写错的 skill 验证它。

预计用时 2.5 小时。实跑花费约 ¥0.057,算式在「第五步」里。前置:[Day 295](/blog/agent-zero/day-295-text-to-sql-4/)(上一课,CloudLedger 业务库的样子)、[Day 85](/blog/agent-zero/day-085-sql-1/) 和 [Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(SQLite 和 Python 里的 `sqlite3`)、[Day 37](/blog/agent-zero/day-037-pathlib/)(`pathlib`)、[Day 39](/blog/agent-zero/day-039-json/)(JSON 互转)。今天不用调工具,也不写 Agent 循环,模型只在第五步里被问了 24 次。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `frontmatter.py` 的 `split_frontmatter()` 和 `calc_refund.py` 的 `months_used()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库,和前几天是同一份 30 个客户、123 张发票:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。随机种子固定,每次数据一样,下面所有数字都能和你对上。

</div>

## 一份越写越长的 system prompt

先想一个你在前端项目里见过的东西。一个单页应用,把所有页面的代码打进一个 `main.js`,用户只看首页,也得下载后台管理页、设置页、报表页的代码。后来大家学会了代码分割:首页只带路由表,点进哪个页面才 `import()` 哪个页面的 chunk。

客服 Agent 的 system prompt 就是那个 `main.js`。一开始只有「你是云簿客服,不承诺补偿」一句。接着加退款规则,加发票抬头规则,加两步验证怎么关,加 VIP 客户怎么走……每一条都对,但客户今天只是问「发票抬头写错了」,退款那一大段规则对这次对话一点用处没有,却照样每次请求都发一遍、付一遍钱,还挤占模型的注意力。

Skill 就是 Agent 的代码分割。**每个 skill 一个文件夹,启动时只把「名字加一句话描述」放进上下文,当作路由表;模型觉得这次任务和某句描述对得上,再去把那个文件夹里的正文读进来。** 路由表的字数是常数,说明书的字数是按需付的。

## Skill 到底是什么

一句话:一个文件夹,里面至少有一个叫 `SKILL.md` 的文件。今天要写的 `refund-policy` 长这样:

```text
refund-policy/
├── SKILL.md              必需:开头是元数据(名字、描述),后面是怎么做
├── references/
│   └── policy.md         可选:详细规则,用到才读
└── scripts/
    ├── calc_refund.py    可选:算金额,模型运行它,只看输出
    └── find_duplicates.py
```

`SKILL.md` 开头是一段用 `---` 包起来的元数据,叫 frontmatter(它的格式是 YAML,你可以把它想成「写在 Markdown 文件头部的一小段 JSON,换成了缩进写法」),后面是 Markdown 正文,写给模型看的操作手册。frontmatter 里只有两个字段必填:`name` 和 `description`。正文怎么写没有格式要求。

它和普通 system prompt 的区别不在写法,而在**什么时候进上下文**。规范把这件事叫渐进式披露(progressive disclosure),信息分三层,按需往外拿:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="三层加载:第一层名字和描述常驻上下文,第二层 SKILL.md 正文触发时读入,第三层参考文件和脚本用到才读,脚本只有输出进上下文">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型的上下文里有什么</text>
  <rect x="20" y="40" width="380" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="34" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第一层 · 启动时:所有 skill 的 name + description</text>
  <text x="34" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个约 100 token,一直在,相当于路由表</text>
  <rect x="20" y="115" width="380" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="5 3"/>
  <text x="34" y="139" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第二层 · 触发时:这一个 skill 的 SKILL.md 正文</text>
  <text x="34" y="161" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">建议少于 5000 token、500 行</text>
  <rect x="20" y="190" width="380" height="80" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="5 3"/>
  <text x="34" y="214" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第三层 · 用到时:references/ 里的某个文件</text>
  <text x="34" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没读就是 0 token</text>
  <text x="34" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">scripts/ 只有运行输出进上下文,源码不进</text>
  <rect x="440" y="40" width="180" height="230" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="530" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">文件系统</text>
  <text x="456" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">.claude/skills/</text>
  <text x="468" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">refund-policy/</text>
  <text x="480" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SKILL.md</text>
  <text x="480" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">references/</text>
  <text x="480" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">scripts/</text>
  <text x="468" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">invoice-title-change/</text>
  <text x="468" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">...</text>
  <line x1="400" y1="145" x2="440" y2="140" stroke="var(--ink-faint)"/>
  <line x1="400" y1="230" x2="440" y2="170" stroke="var(--ink-faint)"/>
  <text x="20" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">实线框一直在上下文里;虚线框需要时才从右边的文件读进来</text>
</svg>
<figcaption>Skills 的三层加载。数字(约 100 token、少于 5000 token、500 行)是 agentskills.io 规范 2026 年 10 月的建议值,不是硬上限。</figcaption>
</figure>

第一层是一张目录:每个 skill 的名字和描述,启动时就放进上下文。模型读到用户的问题,觉得和哪句描述对得上,就去读那个 skill 的正文,这是第二层。正文里如果写了「拿不准再读 `references/policy.md`」或者「运行 `scripts/calc_refund.py` 算金额」,模型照做的时候才碰到第三层。

第三层里的脚本值得多说一句。退款金额这种有唯一正确答案的事,让模型心算有出错的概率;写成脚本,模型只需要运行它、读一行 JSON。脚本的源码一个 token 都不进上下文,进去的只有输出。今天第五步会把这件事量给你看。

有一个容易漏掉的前提:第二、三层得靠**模型自己去读文件、跑命令**。Claude Code、Codex 这类产品本来就带着读文件和执行命令的工具,所以 skill 在它们那里是零代码的。你自己写的 Agent 循环没有这些能力,得自己提供,这是 Day 297 的内容。

### 谁认这个格式

Anthropic 2025 年 10 月把 Skills 做进 Claude 的产品,2025 年 12 月 18 日把格式作为开放标准发布在 [agentskills.io](https://agentskills.io/specification)。OpenAI 的 Codex 也读同样的 `SKILL.md`:它的文档(2026 年 10 月查到)写着启动时先看每个 skill 的名字和描述,决定用了才加载完整说明,只是找 skill 的目录不同,Claude Code 找 `.claude/skills/`,Codex 找 `.agents/skills/`。多少家产品支持我没有数,你以官方客户端展示页为准。对你来说结论只有一条:**写一份,换个目录就能在别家用**,所以只写标准里的字段最保险。

### frontmatter 的规则

下面是规范(2026 年 10 月查的)对每个字段的要求:

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `name` | 是 | 1 到 64 个字符,只能用小写字母、数字和连字符;不能以连字符开头或结尾,不能连着两个 `--`;**必须和所在目录同名** |
| `description` | 是 | 1 到 1024 个字符,不能为空;要同时写清「做什么」和「什么时候用」 |
| `license` | 否 | 许可证名,或者随 skill 带的许可证文件名 |
| `compatibility` | 否 | 1 到 500 个字符,写环境要求,比如「需要 git 和 docker」 |
| `metadata` | 否 | 字符串到字符串的映射,放作者、版本这类自定义信息 |
| `allowed-tools` | 否 | 预先批准的工具,空格分隔;规范标着「实验性」,各家支持程度不一 |

Claude Code 在标准之外还认一批扩展字段,比如 `disable-model-invocation`、`context`、`paths`、`when_to_use`,明天用到再讲。它的文档里有一句话要记住:字段名必须完全匹配,**写错了会被静默忽略**,不报错也不生效。这类错最难查,所以我们待会儿自己写检查器。

`description` 是整个 skill 最重要的一行,模型决定用不用你的 skill,看的就是它。「帮助处理退款」太虚了,模型分不清它和「发票抬头」「两步验证」有什么边界。好的写法是前半句说做什么,后半句把客户真实会说的话列出来:「云簿 CloudLedger 的退款判断与金额计算。客户问能不能退款、能退多少、被重复扣款了怎么退、年付中途取消怎么算时使用。」这和 [Day 157](/blog/agent-zero/day-157-tool-schema/) 写工具描述是同一个道理,本质上 description 就是一个工具的描述,只不过「调用」它的动作是读一个文件。

## 第一步:建目录,写规则原文

先把目录建出来。`.claude/skills/` 是 Claude Code 找项目级 skill 的位置,放在仓库里提交,整个团队共用;明天会在它里面直接跑。

```bash
mkdir -p .claude/skills/refund-policy/{references,scripts}
mkdir -p .claude/skills/invoice-title-change
mkdir -p part05/skills
touch part05/__init__.py part05/skills/__init__.py
```

<div class="line-notes">

- `mkdir -p .claude/skills/refund-policy/{references,scripts}` `-p` 表示父目录不存在就一起建;`{references,scripts}` 是 shell 的花括号展开,等价于连写两个路径。
- `mkdir -p .claude/skills/invoice-title-change` 第二个 skill 只有一个 `SKILL.md`,不需要子目录。
- `mkdir -p part05/skills` 今天的 Python 代码放这里,和前几天的 `part05/text2sql/` 并列。
- `touch part05/__init__.py part05/skills/__init__.py` 让 `part05` 和 `part05.skills` 能被 `python -m` 当包导入。前几天建过的话,`touch` 只是更新时间,不会覆盖内容。

</div>

规则原文放在 `.claude/skills/refund-policy/references/policy.md`,这是第三层,模型拿不准时才会去读:

```markdown
# 云簿退款政策(2026 版)

1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。
2. 年付(专业版和企业版)中途取消:按剩余整月数退款,已使用月份和当月不退;基础版年付不退,取消后当期结束不再续费。
3. 月付:不支持中途退款,取消后当期结束不再续费。
4. 所有退款需客服主管审批后执行。

## 例外

- 试用中(trialing)的订阅没有付过钱,不存在退款。
- 已取消(canceled)的订阅不再计算退款,只处理当期结束前的重复扣款。
- 发票已开具的,需要先红冲再退款(见帮助中心「如何申请退款」)。
```

规则只维护这一份。以后知识库、MCP 的 resource、这个 skill 如果都要用到退款规则,最好从同一个源文件生成,别手工复制三份,改的时候肯定漏一份。

## 第二步:写 SKILL.md

`.claude/skills/refund-policy/SKILL.md` 是整个 skill 的入口:

```markdown
---
name: refund-policy
description: 云簿 CloudLedger 的退款判断与金额计算。客户问能不能退款、能退多少、被重复扣款了怎么退、年付中途取消怎么算时使用。
metadata:
  owner: support-team
  version: "1.0"
---

# 云簿退款处理

## 先判断属于哪种情况

1. 客户说被重复扣款:运行 `uv run python .claude/skills/refund-policy/scripts/find_duplicates.py <客户ID>`,脚本会列出同一天、同金额的已付发票。只有它列出了发票对,才算重复扣款;没列出就如实告诉客服「没查到」,不要猜。
2. 年付中途取消:运行 `uv run python .claude/skills/refund-policy/scripts/calc_refund.py <客户ID> --today <今天的日期>`,金额以脚本输出为准,不要自己心算。
3. 月付:不支持中途退款,取消后当期结束不再续费。直接告诉客户,不用算。

规则原文和例外情况在 [references/policy.md](references/policy.md),拿不准时再读。

## 脚本怎么用

两个脚本都输出一行 JSON,只读数据库,不改任何东西。`calc_refund.py` 里 `refund_yuan` 是可退金额,`rule` 是依据的条款编号。脚本报错(输出里有 `error` 字段)时把错误原样告诉客服,不要自己编一个数。

## 回复客户时

- 写清楚可退金额和依据(第几条)。
- 一定说明「退款需要客服主管审批,审批通过后原路退回」。
- 不要承诺到账时间以外的任何东西,比如补偿、优惠券。
```

<div class="line-notes">

- `name: refund-policy` 和目录名 `refund-policy` 一字不差。规范要求两者相同,不一致的话有的客户端会直接跳过这个 skill,明天我们自己写的加载器也会跳过。
- `description: 云簿 CloudLedger 的退款判断与金额计算。` 整个 description 一共 63 个字符,远低于 1024 的上限。前半句说做什么,后半句列触发场景:「能不能退款」「能退多少」「重复扣款」「年付中途取消」,都是客服工单里客户的原话。
- `metadata:` 规范允许的可选字段,值必须是字符串,所以版本号写成 `"1.0"` 带引号,不然 YAML 会把它当成数字 1.0。后面两行缩进的 `owner`、`version` 属于它。
- `# 云簿退款处理` 从这里往下是第二层,只有 skill 被触发时才进上下文。整个正文 21 行、624 个字符,远小于建议的 500 行。
- `1. 客户说被重复扣款:运行` 只写判断标准和用哪个脚本,不写 SQL。skill 不绑定具体工具,换个环境也能用。「只有它列出了发票对,才算重复扣款;没列出就如实告诉客服」这半句专门堵模型的一个毛病:查不到时自己编一个。
- `2. 年付中途取消:运行` 把计算交给脚本,并且明说「不要自己心算」,第五步会量出不这么说的代价。命令写的是 `uv run python`,不是 `python`:macOS 上通常只有 `python3`,而 `uv run` 保证用的是项目的虚拟环境。另外 `--today <今天的日期>` 是有意的:模型不知道今天几号,让它把日期当参数传进来,脚本就不会悄悄用机器的当前时间,日期的来源清清楚楚。
- `3. 月付:不支持中途退款` 这条连脚本都不用跑,正文直接给结论。不是什么都要写成脚本,规则一句话能说清的就写在正文里。
- `规则原文和例外情况在 [references/policy.md](references/policy.md)` 第三层的入口。路径是相对 skill 根目录的,规范建议引用只深入一层,别让 `policy.md` 再引用别的文件。
- `两个脚本都输出一行 JSON,只读数据库` 告诉模型两件事:输出长什么样,以及它们不会改库。后面「脚本报错(输出里有 `error` 字段)时把错误原样告诉客服」是明确规定出错时怎么办,不留给模型自由发挥。
- `- 一定说明「退款需要客服主管审批,审批通过后原路退回」。` 对应政策第 4 条。skill 负责让回复的口径一致,真正「提交退款申请」是工具(比如 [Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 的 `create_refund_request`)的事,skill 里没有重复写。

</div>

下面这张图把 `SKILL.md` 里「先判断属于哪种情况」画成了流程。每条路最后都落在一个确定的东西上:要么是脚本,要么是正文里的一句话。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="退款 skill 的判断流程:重复扣款走 find_duplicates 脚本,年付取消走 calc_refund 脚本,月付直接回答,三条路最后都要说明需要主管审批">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <rect x="20" y="85" width="120" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="80" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">客户的问题</text>
  <text x="80" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">属于哪种情况</text>
  <rect x="230" y="20" width="170" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="315" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">重复扣款</text>
  <text x="315" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">find_duplicates.py</text>
  <rect x="230" y="89" width="170" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="315" y="111" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">年付中途取消</text>
  <text x="315" y="129" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">calc_refund.py</text>
  <rect x="230" y="158" width="170" height="52" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="315" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">月付</text>
  <text x="315" y="198" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">正文一句话,不用算</text>
  <rect x="470" y="85" width="150" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="545" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">回复客户</text>
  <text x="545" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写依据 + 说要审批</text>
  <line x1="140" y1="105" x2="230" y2="46" stroke="var(--ink-faint)"/>
  <line x1="140" y1="115" x2="230" y2="115" stroke="var(--ink-faint)"/>
  <line x1="140" y1="125" x2="230" y2="184" stroke="var(--ink-faint)"/>
  <line x1="400" y1="46" x2="470" y2="105" stroke="var(--ink-faint)"/>
  <line x1="400" y1="115" x2="470" y2="115" stroke="var(--ink-faint)"/>
  <line x1="400" y1="184" x2="470" y2="125" stroke="var(--ink-faint)"/>
</svg>
<figcaption>琥珀色是脚本(确定性的计算),蓝色是模型要做的事(判断属于哪种、怎么跟客户说)。模型负责分流和措辞,数字不经过它。</figcaption>
</figure>

再写第二个 skill,`.claude/skills/invoice-title-change/SKILL.md`,用来考模型「选得对不对」:

```markdown
---
name: invoice-title-change
description: 处理发票抬头、税号修改申请。客户说发票抬头写错了、要改公司名或税号、要重开发票时使用。
---

# 发票抬头修改

1. 开票 90 天内可以改抬头,超过 90 天不能改,只能下次开票时用新抬头。
2. 电子普通发票:作废原票后重开,当天完成。
3. 增值税专用发票:需要客户先退回原票或提供红字信息表,再重开。
4. 回复里说明需要客户提供的新抬头全称和税号,别替客户填。
```

<div class="line-notes">

- `name: invoice-title-change` 目录名也叫这个。三个单词用连字符连起来,是 skill 命名的常见写法。
- `description: 处理发票抬头、税号修改申请。` 43 个字符。和 `refund-policy` 的描述放在一起看:一个讲「退款、重复扣款、年付取消」,一个讲「抬头、税号、重开发票」,词几乎不重叠,模型才不会选混。
- `# 发票抬头修改` 没有 `references/`,没有 `scripts/`,整个 skill 只有这一个文件,正文 8 行。这是完全合法的。大多数 skill 其实都长这样,脚本和参考文件是需要时才加的。
- `1. 开票 90 天内可以改抬头` 规则本身是我为云簿编的演示规则,不是真实的税务规定。
- `4. 回复里说明需要客户提供的新抬头全称和税号,别替客户填。` 「不要做什么」和「要做什么」一样重要。写 skill 和写工具描述一样,第一版总会漏掉一个坑,等模型踩了再补。

</div>

## 第三步:写脚本,把金额交给代码

`calc_refund.py` 是今天最长的一段代码,但每一行都是已经学过的东西:`argparse` 读命令行、`sqlite3` 查库、`json` 输出。它放在 `.claude/skills/refund-policy/scripts/`,逻辑是:先排除不用算的情况(没这个客户、试用或已取消、月付、基础版年付),剩下的才去算「账期用了几个月,还剩几个月,发票金额按剩余月数折算」。

```python
# agent-zero-lab/.claude/skills/refund-policy/scripts/calc_refund.py
"""年付中途取消的可退金额。用法:python calc_refund.py C023 [--today 2026-10-23]"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import date
from pathlib import Path

# 脚本往上数:scripts → refund-policy → skills → .claude → 仓库根,所以不管从哪个目录运行都找得到库
DEFAULT_DB = Path(__file__).resolve().parents[4] / "cloudledger" / "cloudledger.db"
DB = Path(os.environ.get("CLOUDLEDGER_DB", DEFAULT_DB))


def minus_one_year(d: date) -> date:
    """往前推一年。2 月 29 日推一年没有这一天,退到 2 月 28 日。"""
    try:
        return d.replace(year=d.year - 1)
    except ValueError:
        return d.replace(year=d.year - 1, day=28)


def months_used(start: date, today: date) -> int:
    """从账期开始到今天用了几个月,当月算用过。"""
    diff = (today.year - start.year) * 12 + today.month - start.month
    if today.day < start.day:
        diff -= 1
    return diff + 1


def out(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("customer_id")
    p.add_argument("--today", default=date.today().isoformat())
    a = p.parse_args()
    today = date.fromisoformat(a.today)

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    sub = conn.execute("SELECT * FROM subscriptions WHERE customer_id = ?", (a.customer_id,)).fetchone()
    if sub is None:
        out({"error": f"找不到客户 {a.customer_id} 的订阅"})
        return 1
    base = {"customer_id": a.customer_id, "plan": sub["plan"], "billing_cycle": sub["billing_cycle"]}
    if sub["status"] in ("trialing", "canceled"):
        out({**base, "refund_yuan": 0, "rule": "例外", "why": f"订阅状态是 {sub['status']}"})
        return 0
    if sub["billing_cycle"] == "monthly":
        out({**base, "refund_yuan": 0, "rule": "3", "why": "月付不支持中途退款"})
        return 0
    if sub["plan"] == "基础版":
        out({**base, "refund_yuan": 0, "rule": "2", "why": "基础版年付不退"})
        return 0

    # 取这个订阅最新开出的一张发票,不管有没有付款。要是只挑「已付款的最新一张」,
    # 本期发票还没付时会翻出去年的发票来算,金额就错了
    inv = conn.execute(
        "SELECT id, amount_cents, status FROM invoices WHERE subscription_id = ? ORDER BY issued_at DESC LIMIT 1",
        (sub["id"],),
    ).fetchone()
    if inv is None or inv["status"] != "paid":
        state = "没有发票" if inv is None else f"最新发票 {inv['id']} 的状态是 {inv['status']}"
        out({**base, "error": f"本期发票还没付款({state}),没有可退的钱,请先核对付款状态"})
        return 1
    end = date.fromisoformat(sub["current_period_end"])
    start = minus_one_year(end)
    used = months_used(start, today)
    remaining = max(0, 12 - used)
    refund_cents = inv["amount_cents"] * remaining // 12
    out({
        **base, "invoice_id": inv["id"], "period": f"{start} ~ {end}",
        "months_used": used, "months_refundable": remaining,
        "refund_yuan": refund_cents / 100, "rule": "2",
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

<div class="line-notes">

- `import argparse` 标准库里读命令行参数的模块,相当于 Node 里的 `commander` 或 `yargs`,不用装。
- `DEFAULT_DB = Path(__file__).resolve().parents[4] / "cloudledger" / "cloudledger.db"` 从脚本位置往上数:`parents[0]` 是 `scripts`,`[1]` 是 `refund-policy`,`[2]` 是 `skills`,`[3]` 是 `.claude`,`[4]` 才是仓库根 `agent-zero-lab`。skill 被调用时,当前目录不一定是仓库根,所以按脚本自己的位置算路径,不依赖从哪里运行。
- `DB = Path(os.environ.get("CLOUDLEDGER_DB", DEFAULT_DB))` 设了环境变量 `CLOUDLEDGER_DB` 就用它,没设用默认值,方便测试时指到一份副本。
- `def minus_one_year(d: date) -> date:` 账期开始日不在库里,要用结束日往前推一年。
- `return d.replace(year=d.year - 1)` 代入 C023:结束日 `2027-10-09` 推成 `2026-10-09`。
- `except ValueError:` 2028-02-29 往前推一年是 2027-02-29,不存在,`replace` 会抛 `ValueError`。这时退到 2 月 28 日。我实测 `minus_one_year(date(2028, 2, 29))` 得到 `2027-02-28`。
- `def months_used(start: date, today: date) -> int:` 「用了几个月」的定义,全部逻辑就在这几行,所以单独成函数方便测。
- `diff = (today.year - start.year) * 12 + today.month - start.month` 先算日历上差了几个月份。账期 `2026-10-09` 开始,今天 `2026-10-23`:`(2026-2026)*12 + 10 - 10 = 0`。
- `if today.day < start.day:` 今天是 23 号,不小于 9 号,不减。如果今天是 `2026-11-08`:月份差是 1,但 8 小于 9,说明还没满一个整月,减回 0。
- `return diff + 1` 当月算用过,所以 C023 在 10-23 用了 1 个月;11-08 也是 1 个月;11-09 才是 2 个月;2027-03-15 是 `(1)*12 + 3 - 10 = 5`,15 不小于 9,`5 + 1 = 6`,用了 6 个月。我对这四天实测得到 `1 1 2 6`。
- `def out(obj: dict) -> None:` 所有输出都走这一个函数,保证每次只打印一行 JSON。
- `print(json.dumps(obj, ensure_ascii=False))` `ensure_ascii=False` 让中文原样输出,不会变成 `企业`,模型和人都读得懂。
- `p.add_argument("customer_id")` 位置参数,必须给。不给会怎样:`usage: calc_refund.py [-h] [--today TODAY] customer_id` 加一行 `error: the following arguments are required: customer_id`,退出码 2。
- `p.add_argument("--today", default=date.today().isoformat())` 可选参数,不传就用机器的今天。演示和测试都显式传 `--today`,结果才能复现。
- `a = p.parse_args()` 解析命令行,`a.customer_id` 是 `"C023"`,`a.today` 是 `"2026-10-23"`。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` `mode=ro` 是只读打开。skill 的脚本只负责算,不写库;就算它有 bug 或者被人改了,也写不进去。
- `conn.row_factory = sqlite3.Row` 查出来的行可以用列名取值,`sub["plan"]`,不用记第几列([Day 93](/blog/agent-zero/day-093-python-sqlite-2/))。
- `sub = conn.execute("SELECT * FROM subscriptions WHERE customer_id = ?", (a.customer_id,)).fetchone()` C023 查到 `S023 | 企业版 | yearly | 2 席 | active | 2027-10-09`。
- `if sub is None:` 传一个不存在的 `C999`,输出 `{"error": "找不到客户 C999 的订阅"}`,退出码 1。`SKILL.md` 里交代了「报错时原样告诉客服」。
- `base = {"customer_id": a.customer_id, "plan": sub["plan"], "billing_cycle": sub["billing_cycle"]}` 每种输出都带这三样,模型能看出脚本查的是谁。
- `if sub["status"] in ("trialing", "canceled"):` 实测 C026(专业版年付,还在试用)输出 `"refund_yuan": 0, "rule": "例外", "why": "订阅状态是 trialing"`;C030 是 `canceled`。
- `out({**base, "refund_yuan": 0, "rule": "例外"` `**base` 把字典展开合并,相当于 JS 的 `{...base, refund_yuan: 0}`。
- `if sub["billing_cycle"] == "monthly":` 实测 C007(企业版月付)输出 `"rule": "3", "why": "月付不支持中途退款"`。
- `if sub["plan"] == "基础版":` 实测 C009(基础版年付 3 席)输出 `"rule": "2", "why": "基础版年付不退"`。
- `inv = conn.execute(` 取这个订阅**最新开出的一张发票**,不管有没有付款。上面的注释解释了为什么,下面「第一版的 bug」会演示。
- `"SELECT id, amount_cents, status FROM invoices WHERE subscription_id = ? ORDER BY issued_at DESC LIMIT 1",` C023 取到 `INV-2026-0091`,717600 分,状态 `paid`。
- `if inv is None or inv["status"] != "paid":` 没有发票,或者最新一张还没付,都拒绝计算。`or` 短路:`inv is None` 为真就不会去取 `inv["status"]`,不会报 `NoneType` 错误。
- `state = "没有发票" if inv is None else f"最新发票 {inv['id']} 的状态是 {inv['status']}"` 把原因写具体,C013 得到 `最新发票 INV-2026-0050 的状态是 open`。
- `end = date.fromisoformat(sub["current_period_end"])` `"2027-10-09"` 变成日期对象,可以做比较和运算。
- `start = minus_one_year(end)` 账期开始 `2026-10-09`。
- `used = months_used(start, today)` C023 在 10-23:`1`。
- `remaining = max(0, 12 - used)` `12 - 1 = 11`。`max(0, ...)` 防止账期已过、`used` 超过 12 时出现负数。
- `refund_cents = inv["amount_cents"] * remaining // 12` `717600 × 11 // 12 = 657800` 分。先乘后除,用整数除法 `//`,全程在「分」上算,不碰浮点。
- `"refund_yuan": refund_cents / 100, "rule": "2",` 除以 100 变成元,`657800 / 100 = 6578.0`。完整输出:`{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0091", "period": "2026-10-09 ~ 2027-10-09", "months_used": 1, "months_refundable": 11, "refund_yuan": 6578.0, "rule": "2"}`。
- `sys.exit(main())` 把 `main()` 返回的 0 或 1 当作进程退出码。shell 里用 `echo $?` 能看到,相当于 Node 里的 `process.exit(code)`。调用方靠它判断成功还是失败。

</div>

运行,先看几种典型情况(今天按 2026-10-23 算):

```bash
for c in C023 C005 C028 C009 C007 C026 C013 C999; do
  uv run python .claude/skills/refund-policy/scripts/calc_refund.py $c --today 2026-10-23
done
```

```text
{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0091", "period": "2026-10-09 ~ 2027-10-09", "months_used": 1, "months_refundable": 11, "refund_yuan": 6578.0, "rule": "2"}
{"customer_id": "C005", "plan": "专业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0018", "period": "2026-10-12 ~ 2027-10-12", "months_used": 1, "months_refundable": 11, "refund_yuan": 13068.0, "rule": "2"}
{"customer_id": "C028", "plan": "企业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0111", "period": "2026-10-10 ~ 2027-10-10", "months_used": 1, "months_refundable": 11, "refund_yuan": 39468.0, "rule": "2"}
{"customer_id": "C009", "plan": "基础版", "billing_cycle": "yearly", "refund_yuan": 0, "rule": "2", "why": "基础版年付不退"}
{"customer_id": "C007", "plan": "企业版", "billing_cycle": "monthly", "refund_yuan": 0, "rule": "3", "why": "月付不支持中途退款"}
{"customer_id": "C026", "plan": "专业版", "billing_cycle": "yearly", "refund_yuan": 0, "rule": "例外", "why": "订阅状态是 trialing"}
{"customer_id": "C013", "plan": "专业版", "billing_cycle": "yearly", "error": "本期发票还没付款(最新发票 INV-2026-0050 的状态是 open),没有可退的钱,请先核对付款状态"}
{"error": "找不到客户 C999 的订阅"}
```

C023 是 6578 元,C005 是 13068 元,C028 是 39468 元,和第五步评测的标准答案是同一批。C009、C007、C026 各自命中一条「不退」的规则,理由写在 `why` 里。C013 报错,下面讲。

### 第一版的 bug:翻出去年的发票

这个脚本我第一版取发票写的是 `WHERE subscription_id = ? AND status = 'paid' ORDER BY issued_at DESC LIMIT 1`,也就是「挑最近一张已付款的发票」,看起来很合理。给 C013 跑一次:

```text
{"customer_id": "C013", "plan": "专业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0051", "period": "2026-10-09 ~ 2027-10-09", "months_used": 1, "months_refundable": 11, "refund_yuan": 1089.0, "rule": "2"}
```

输出看着一切正常:专业版年付、1 个月、可退 1089 元。但账期是 2026-10-09 到 2027-10-09,发票号却是 `INV-2026-0051`。去库里一查:

```bash
sqlite3 cloudledger/cloudledger.db "select id,amount_cents,status,issued_at from invoices where subscription_id='S013' order by issued_at desc"
```

```text
INV-2026-0050|118800|open|2026-10-09
INV-2026-0051|118800|paid|2025-10-15
INV-2026-0052|118800|paid|2024-10-21
```

本期的发票 `INV-2026-0050` 是 `open`,客户这一期还没付钱。`status = 'paid'` 的过滤把它跳过去了,翻出了**去年**已付款的那一张,拿它算出一个「可退 1089 元」。这个数字看起来没毛病,会被模型原样告诉客服,而客户这一期根本没付过钱,不该退任何东西。

没有报错,没有异常,只有一个看着合理的错数字。这种 bug 最危险。修法是脚本现在的样子:先取**最新**的一张,不管状态,再判断状态是不是 `paid`;不是就报错,让人去核对付款。练习 4 会把它写成测试,做一次「把修复改回去,测试能不能抓到」的实验。

## 第四步:再写一个脚本,查重复扣款

`SKILL.md` 第一条路径(重复扣款)用的是 `find_duplicates.py`。思路和 [Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 的分组查询一样:找「同一天、同金额」的已付发票。

```python
# agent-zero-lab/.claude/skills/refund-policy/scripts/find_duplicates.py
"""找出某个客户「同一天、同金额」的已付发票,疑似重复扣款。只读。用法:python find_duplicates.py C007"""
import json
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[4] / "cloudledger" / "cloudledger.db"
DB = Path(os.environ.get("CLOUDLEDGER_DB", DEFAULT_DB))


def main(customer_id: str) -> int:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT issued_at, amount_cents, GROUP_CONCAT(id, ',') FROM invoices "
        "WHERE customer_id = ? AND status = 'paid' "
        "GROUP BY issued_at, amount_cents HAVING COUNT(*) > 1",
        (customer_id,),
    ).fetchall()
    pairs = [
        {"issued_at": day, "amount_yuan": cents / 100, "invoice_ids": ids.split(",")}
        for day, cents, ids in rows
    ]
    print(json.dumps({"customer_id": customer_id, "duplicates": pairs}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "用法:find_duplicates.py <客户ID>,例如 C007"}, ensure_ascii=False))
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
```

<div class="line-notes">

- `DEFAULT_DB = Path(__file__).resolve().parents[4] / "cloudledger" / "cloudledger.db"` 和 `calc_refund.py` 同一个约定:按脚本自己的位置往上数四级找到仓库根。
- `def main(customer_id: str) -> int:` 比第一个脚本简单,没有 `argparse`,客户编号直接从 `sys.argv` 来。
- `"SELECT issued_at, amount_cents, GROUP_CONCAT(id, ',') FROM invoices "` `GROUP_CONCAT(id, ',')` 把同一组里的发票号用逗号拼成一个字符串。
- `"WHERE customer_id = ? AND status = 'paid' "` 只看已付款的。`open` 的发票还没扣钱,谈不上重复扣款。
- `"GROUP BY issued_at, amount_cents HAVING COUNT(*) > 1",` 按「同一天加同金额」分组,`HAVING` 只留下组里不止一张的。`WHERE` 过滤的是行,`HAVING` 过滤的是分组之后的组。实测 C007 有 5 张已付发票,分成 4 组,只有 `('2026-10-08', 239200)` 这组有 2 张。
- `pairs = [` 把每一组整理成字典:`{"issued_at": "2026-10-08", "amount_yuan": 2392.0, "invoice_ids": ["INV-2026-0026", "INV-2026-0123"]}`。
- `"invoice_ids": ids.split(",")` `ids` 是 `"INV-2026-0026,INV-2026-0123"`,按逗号切回列表,模型读列表比读拼接字符串省事。
- `if len(sys.argv) != 2:` 没带客户编号就直接 `sys.argv` 取值会抛 `IndexError`,堆栈很长,模型读不懂。这里先检查长度,给一句人话的用法提示。
- `sys.exit(2)` 参数不对用 2 退出,是命令行工具的惯例(`argparse` 报参数错误也是 2);0 是成功,1 是业务上算失败。

</div>

```bash
uv run python .claude/skills/refund-policy/scripts/find_duplicates.py C007
uv run python .claude/skills/refund-policy/scripts/find_duplicates.py C003
uv run python .claude/skills/refund-policy/scripts/find_duplicates.py
```

```text
{"customer_id": "C007", "duplicates": [{"issued_at": "2026-10-08", "amount_yuan": 2392.0, "invoice_ids": ["INV-2026-0026", "INV-2026-0123"]}]}
{"customer_id": "C003", "duplicates": []}
{"error": "用法:find_duplicates.py <客户ID>,例如 C007"}
```

C007 的 `INV-2026-0026` 和 `INV-2026-0123` 是 [Day 280](/blog/agent-zero/day-280-mcp-seed/) 种子数据里故意造的重复扣款。C003 没有,`duplicates` 是空列表,不是报错:「没查到」是一个正常的答案,`SKILL.md` 里要求模型这时如实说没查到。

## 第五步:让模型自己算算看,再对答案

前面几步一直在说「金额交给脚本」。凭什么?退款规则是「按剩余整月数退,已使用月份和当月不退」,听起来不难,让模型自己算行不行?量一下。

云簿有 11 个年付订阅。基础版、试用、已取消的不退,专业版和企业版里状态正常的有 4 个,其中 C013 本期发票没付、脚本会拒绝算,剩下三个我全挑上:C023(企业版 2 席,发票 7176 元)、C005(专业版 12 席,14256 元)、C028(企业版 12 席,43056 元)。每个客户配四个日期,一共 12 道题,标准答案由第三步的 `calc_refund.py` 给。

评测脚本做的事:对 12 道题,把规则原文和客户的事实(套餐、账期、发票金额、今天的日期)拼成问题发给模型,和脚本的答案对。**只给事实,不给「用了几个月」**,月数得模型自己数。分两种问法:直接报数,和允许先写步骤。

```python
# agent-zero-lab/part05/skills/mental_math.py
"""让模型心算退款金额,和脚本的结果逐个对答案。用法:uv run python -m part05.skills.mental_math [直接报数|写步骤]"""
import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

from common.llm import LLMClient

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".claude/skills/refund-policy/scripts/calc_refund.py"
POLICY = (ROOT / ".claude/skills/refund-policy/references/policy.md").read_text(encoding="utf-8")

CUSTOMERS = ["C023", "C005", "C028"]  # 企业版 2 席、专业版 12 席、企业版 12 席,都是年付
DAYS = ["2026-10-23", "2026-11-08", "2027-03-15", "2027-10-01"]
ASK = {
    "直接报数": "按政策算这位客户能退多少钱。只回答一个数字,单位元,保留两位小数,不要解释。",
    "写步骤": "按政策算这位客户能退多少钱。先一步一步写出怎么算,最后另起一行,格式严格是「答案:数字」,单位元。",
}


def by_script(customer: str, today: str) -> dict:
    r = subprocess.run([sys.executable, str(SCRIPT), customer, "--today", today],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def invoice_cents(invoice_id: str) -> int:
    conn = sqlite3.connect(ROOT / "cloudledger/cloudledger.db")
    return conn.execute("SELECT amount_cents FROM invoices WHERE id = ?", (invoice_id,)).fetchone()[0]


def facts(customer: str, today: str, s: dict) -> str:
    """把客户的事实写成一段话。只给原始事实,不给「用了几个月」,月数得模型自己数。"""
    start, end = s["period"].split(" ~ ")
    return (f"客户 {customer},{s['plan']}年付,账期 {start} 到 {end},账期开始时付了一张发票 {s['invoice_id']},"
            f"金额 {invoice_cents(s['invoice_id'])} 分。今天是 {today},客户要求取消订阅。")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "直接报数"
    llm = LLMClient()
    right = total = 0
    for c in CUSTOMERS:
        for day in DAYS:
            s = by_script(c, day)
            prompt = f"退款政策:\n{POLICY}\n事实:{facts(c, day, s)}\n{ASK[mode]}"
            r = llm.chat([{"role": "user", "content": prompt}], temperature=0)
            text = r.content.replace(",", "")
            tail = text.splitlines()[-1] if mode == "写步骤" else text  # 写步骤时只认最后一行,前面的中间数不算
            m = re.search(r"\d+(?:\.\d+)?", tail)
            got = float(m.group()) if m else -1.0
            ok = abs(got - s["refund_yuan"]) < 0.005
            right += ok
            total += 1
            print(f"{c} {day} 脚本 {s['months_refundable']:>2} 月 → {s['refund_yuan']:>9.2f} | 模型 {got:>9.2f} {'对' if ok else '错'}")
    print(f"{mode}:{right}/{total} 对")
    print(llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[2]` 这个文件在 `part05/skills/` 下,`parents[0]` 是 `skills`,`[1]` 是 `part05`,`[2]` 是仓库根 `agent-zero-lab`。用脚本自己的位置算路径,不管你在哪个目录运行都找得到。
- `SCRIPT = ROOT / ".claude/skills/refund-policy/scripts/calc_refund.py"` 第三步写的退款脚本,这里当作「标准答案生成器」。
- `POLICY = (ROOT / ".claude/skills/refund-policy/references/policy.md").read_text(encoding="utf-8")` 把规则原文整个读进来,658 字节,发给模型。
- `CUSTOMERS = ["C023", "C005", "C028"]` 三个年付、有付款的客户。
- `DAYS = ["2026-10-23", "2026-11-08", "2027-03-15", "2027-10-01"]` 四个日期特意挑过:10-23 是账期的第一个月;11-08 差一天满一个月(账期 10-09 开始),最容易数错;03-15 在中间,剩 6 个月;2027-10-01 是账期最后一个月,没有可退的。
- `ASK = {` 两种问法放进字典,命令行参数选一个。`"直接报数"` 要求只回答数字、不解释;`"写步骤"` 允许模型先一步步算,最后一行写「答案:数字」。
- `def by_script(customer: str, today: str) -> dict:` 用子进程把脚本跑一遍,拿它的 JSON 当标准答案。
- `r = subprocess.run([sys.executable, str(SCRIPT), customer, "--today", today],` 列表形式、不经过 shell。`sys.executable` 是当前 Python 解释器的路径,保证用的是项目的虚拟环境。
- `capture_output=True, text=True, check=True)` 抓住标准输出并当文本处理;`check=True` 表示脚本以非 0 退出就抛异常,三个客户都是正常退出,不会触发。
- `return json.loads(r.stdout)` 脚本打印的一行 JSON 变回字典,比如 C023 在 10-23 得到 `{"months_refundable": 11, "refund_yuan": 6578.0, ...}`。
- `def invoice_cents(invoice_id: str) -> int:` 查发票金额,单位是分。
- `return conn.execute("SELECT amount_cents FROM invoices WHERE id = ?", (invoice_id,)).fetchone()[0]` C023 的 `INV-2026-0091` 查到 717600。`?` 占位符配元组 `(invoice_id,)` 是 [Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 讲的参数化写法;`fetchone()` 返回一行,`[0]` 取第一列。
- `def facts(customer: str, today: str, s: dict) -> str:` 把事实拼成一段话。
- `start, end = s["period"].split(" ~ ")` 脚本输出里的 `period` 是 `"2026-10-09 ~ 2027-10-09"`,按 ` ~ ` 切成两个日期。
- `f"金额 {invoice_cents(s['invoice_id'])} 分。今天是 {today},客户要求取消订阅。")` 注意**没有**写「已用 1 个月」,模型要自己从账期开始日和今天算。
- `mode = sys.argv[1] if len(sys.argv) > 1 else "直接报数"` `sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv.slice(1)`;没传就用默认的直接报数。
- `llm = LLMClient()` 用 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 建的 `LLMClient`,账本在 `llm.ledger`。
- `right = total = 0` 一次给两个变量赋同一个初值。
- `prompt = f"退款政策:\n{POLICY}\n事实:{facts(c, day, s)}\n{ASK[mode]}"` 三段拼起来:规则原文、事实、要求。
- `r = llm.chat([{"role": "user", "content": prompt}], temperature=0)` `temperature=0` 让输出尽量稳定,每次问同一道题得到同样的答案。
- `text = r.content.replace(",", "")` 去掉千分位逗号,模型常把 13068 写成 13,068。
- `tail = text.splitlines()[-1] if mode == "写步骤" else text` 写步骤的回答里中间会出现很多数字(比如 717600、12),只认最后一行;直接报数时整段就是答案。
- `m = re.search(r"\d+(?:\.\d+)?", tail)` 找第一个数字,整数或带小数点的都行。`(?:...)` 是不捕获的括号。
- `got = float(m.group()) if m else -1.0` 找不到数字就记 -1,一定算错。
- `ok = abs(got - s["refund_yuan"]) < 0.005` 比较浮点数不用 `==`,差不到半分钱就算对([Day 12](/blog/agent-zero/day-012-numbers/) 讲过浮点误差)。
- `right += ok` 布尔值能直接加,`True` 当 1,和 JS 里 `true + 1` 一样。
- `print(f"{c} {day} 脚本 {s['months_refundable']:>2} 月 → {s['refund_yuan']:>9.2f} | 模型 {got:>9.2f} {'对' if ok else '错'}")` `:>2` 和 `:>9.2f` 是右对齐加固定宽度,输出才排得整齐。
- `print(llm.ledger)` 12 次调用一共多少 token、多少钱。

</div>

先跑直接报数,再跑允许写步骤。`calc_refund.py` 已经建好,可以直接跑。我的结果:

```bash
uv run python -m part05.skills.mental_math 直接报数
```

```text
C023 2026-10-23 脚本 11 月 →   6578.00 | 模型      0.00 错
C023 2026-11-08 脚本 11 月 →   6578.00 | 模型  64584.00 错
C023 2027-03-15 脚本  6 月 →   3588.00 | 模型  35880.00 错
C023 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
C005 2026-10-23 脚本 11 月 →  13068.00 | 模型      0.00 错
C005 2026-11-08 脚本 11 月 →  13068.00 | 模型  11880.00 错
C005 2027-03-15 脚本  6 月 →   7128.00 | 模型   7920.00 错
C005 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
C028 2026-10-23 脚本 11 月 →  39468.00 | 模型      0.00 错
C028 2026-11-08 脚本 11 月 →  39468.00 | 模型  41262.00 错
C028 2027-03-15 脚本  6 月 →  21528.00 | 模型  25833.60 错
C028 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
直接报数:3/12 对
12 次调用 | 输入 3260 / 输出 42 tokens | 约 ¥0.0069
```

```bash
uv run python -m part05.skills.mental_math 写步骤
```

```text
C023 2026-10-23 脚本 11 月 →   6578.00 | 模型   6578.00 对
C023 2026-11-08 脚本 11 月 →   6578.00 | 模型   6578.00 对
C023 2027-03-15 脚本  6 月 →   3588.00 | 模型   3588.00 对
C023 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
C005 2026-10-23 脚本 11 月 →  13068.00 | 模型  13068.00 对
C005 2026-11-08 脚本 11 月 →  13068.00 | 模型  13068.00 对
C005 2027-03-15 脚本  6 月 →   7128.00 | 模型   7128.00 对
C005 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
C028 2026-10-23 脚本 11 月 →  39468.00 | 模型  39468.00 对
C028 2026-11-08 脚本 11 月 →  39468.00 | 模型  39468.00 对
C028 2027-03-15 脚本  6 月 →  21528.00 | 模型  21528.00 对
C028 2027-10-01 脚本  0 月 →      0.00 | 模型      0.00 对
写步骤:12/12 对
12 次调用 | 输入 3356 / 输出 5445 tokens | 约 ¥0.0503
```

两次的差别很明显,但别急着下「模型不会算数」的结论,看清楚三件事。

**第一,直接报数 3 对 12 题,而对的三道全是答案为 0 的那种**,也就是账期最后一个月。凡是需要真的算一次的 9 道题,一道没对。有的答成 0.00(把「当月不退」理解过头了),有的大了十倍左右(64584、35880,正确答案是 6578 和 3588),有的答案差一个月的钱(11880 是 12 席专业版 10 个月,不是 11 个月)。模型不是不会除法,而是被要求「只说数字」时,它没有地方放中间步骤。

**第二,允许写步骤就 12 对 12,包括最容易数错的 11-08**。所以结论不是「模型算不对」,是「它得写出来才算得对,而写出来要钱」。12 次调用输出了 5445 个 token,平均每次 454 个,花了 ¥0.0503;直接报数输出 42 个 token,花了 ¥0.0069。算式:写步骤 `3356 × 2 ÷ 100 万 + 5445 × 8 ÷ 100 万 ≈ 0.0067 + 0.0436 = 0.0503`(输入未命中价 2 元、输出 8 元每百万 token,LLM_PRICE 里的 `0.04,2,8`)。差 7.3 倍。脚本版是 0 个 token。

**第三,这只是一次实验,不是定论**:`temperature=0`,每题问一遍,12 题。换个模型、换个问法数字会变。我想让你带走的是方向:**有唯一正确答案、要花钱的计算,放在脚本里,又稳又省;让模型决定「用哪个脚本、怎么跟客户解释」**。skill 把这种分工装进了一个文件夹。

## 第六步:写一个检查器,不靠肉眼看格式

Claude Code 对写错的字段名是静默忽略的,换到别的产品里,`name` 和目录名不一致还可能让整个 skill 被跳过。人眼检查这些很容易漏,写 skill 越多越漏。规范官方有个参考实现叫 `skills-ref`(`skills-ref validate ./my-skill`),在 [agentskills/agentskills](https://github.com/agentskills/agentskills) 仓库里。我们自己写一个最小的,原因有两个:一是 20 行就能写完、顺便把规则过一遍;二是明天自己写加载器时要用同一个解析函数。

先写解析函数,把 `SKILL.md` 切成「元数据」和「正文」两部分:

```python
# agent-zero-lab/part05/skills/frontmatter.py
"""切开 SKILL.md:开头 --- 包起来的是元数据,后面是正文。只认两种写法:顶层 key: value,和 metadata 下面缩进的 key: value。"""
import re

Meta = dict[str, str | dict[str, str]]


def split_frontmatter(text: str) -> tuple[Meta, str]:
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not m:
        raise ValueError("SKILL.md 开头没有用 --- 包起来的元数据")
    meta: Meta = {}
    current: dict[str, str] | None = None  # 正在往里填的嵌套字典(比如 metadata)
    for line in m.group(1).splitlines():
        if not line.strip():
            continue
        key, _, value = line.strip().partition(":")
        value = value.strip().strip("'\"")
        if line.startswith((" ", "\t")):  # 缩进行:属于上一个顶层 key
            if current is not None:
                current[key.strip()] = value
            continue
        if value == "":  # 「metadata:」后面没值,下面几行缩进的才是内容
            current = {}
            meta[key.strip()] = current
        else:
            current = None
            meta[key.strip()] = value
    return meta, text[m.end():]
```

<div class="line-notes">

- `import re` 正则模块。前端的正则语法大部分能直接用,字符串要写成 `r"..."` 原始字符串,反斜杠就不用写两遍。
- `Meta = dict[str, str | dict[str, str]]` 给一个长类型起个名字(类型别名)。元数据是字典,值要么是字符串(`name`),要么是一层嵌套字典(`metadata`)。
- `def split_frontmatter(text: str) -> tuple[Meta, str]:` 返回一个二元组:元数据字典和正文。`tuple` 相当于 JS 里返回 `[meta, body]`。
- `m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)` 找文件开头的 `---` 到下一个 `---`。`(.*?)` 是非贪婪匹配,取到第一个结束的 `---` 就停;`re.S` 让 `.` 也能匹配换行。对 `refund-policy` 的 `SKILL.md`,第 1 组捕获到的是 5 行:`name`、`description`、`metadata:`、`owner`、`version`。
- `raise ValueError("SKILL.md 开头没有用 --- 包起来的元数据")` 没有元数据就抛错,调用方(检查器)接住并报告。
- `current: dict[str, str] | None = None` 记住「正在往哪个嵌套字典里填」。一开始不在任何嵌套里。
- `for line in m.group(1).splitlines():` 一行一行处理那 5 行。
- `if not line.strip():` 空行直接跳过。
- `key, _, value = line.strip().partition(":")` `partition` 在第一个冒号处切成三份:冒号前、冒号本身(用 `_` 丢掉)、冒号后。只切第一个冒号,所以 description 里就算有冒号,后半截也完整留在 `value` 里。`"owner: support-team"` 切成 `owner`、`:`、` support-team`。
- `value = value.strip().strip("'\"")` 去掉两端空白和引号。`'"1.0"'` 变成 `1.0`,所以 `version` 读出来是字符串 `"1.0"`。
- `if line.startswith((" ", "\t")):` 以空格或制表符开头的行是缩进行,属于上一个顶层 key。
- `current[key.strip()] = value` 填进嵌套字典:`owner` 和 `version` 先后写进 `metadata` 对应的字典。
- `if value == "":` 冒号后面是空的,比如 `metadata:`,说明后面缩进的行才是内容。
- `current = {}` 新建一个空的嵌套字典。
- `meta[key.strip()] = current` 把它挂到 `meta["metadata"]`。因为 `current` 和 `meta["metadata"]` 是同一个对象,之后往 `current` 里填,`meta` 里也跟着有了。这和 JS 里对象是引用一样。
- `current = None` 遇到下一个有值的顶层 key,就不在嵌套里了。
- `return meta, text[m.end():]` `m.end()` 是匹配结束的位置,从那里往后切就是正文。对 `refund-policy`,`meta` 是 `{'name': 'refund-policy', 'description': '云簿 CloudLedger 的退款判断……时使用。', 'metadata': {'owner': 'support-team', 'version': '1.0'}}`,正文 21 行。

</div>

这个解析器只认两种写法,是故意的:顶层 `key: value`,以及一层嵌套。YAML 里多行字符串(`description: >` 再换行写)、列表、更深的嵌套它都不认。真项目里请用 PyYAML 之类现成的库,课程里手写,是为了不为这点事多装一个依赖,也让你看清 frontmatter 其实就是一小段有规则的文本。

接着是检查器本身:

```python
# agent-zero-lab/part05/skills/skill_check.py
"""检查一个 skill 目录合不合规范。用法:uv run python -m part05.skills.skill_check .claude/skills/refund-policy"""
import re
import sys
from pathlib import Path

from part05.skills.frontmatter import split_frontmatter

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")  # 小写字母数字,连字符只能在中间,不能连着两个
STANDARD = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}


def check(skill_dir: Path) -> list[str]:
    """返回问题列表,空列表就是通过。"""
    md = skill_dir / "SKILL.md"
    if not md.is_file():
        return ["缺少 SKILL.md"]
    try:
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
    except ValueError as e:
        return [str(e)]

    problems: list[str] = []
    name = meta.get("name")
    if not isinstance(name, str) or not name:
        problems.append("name 必填")
    else:
        if len(name) > 64:
            problems.append(f"name 有 {len(name)} 个字符,最多 64")
        if not NAME_RE.fullmatch(name):
            problems.append(f"name「{name}」只能用小写字母、数字和连字符,不能以连字符开头结尾,不能连着两个")
        if name != skill_dir.name:
            problems.append(f"name「{name}」和目录名「{skill_dir.name}」不一致")

    desc = meta.get("description")
    if not isinstance(desc, str) or not desc:
        problems.append("description 必填,不能为空")
    elif len(desc) > 1024:
        problems.append(f"description 有 {len(desc)} 个字符,最多 1024")

    for key in meta.keys() - STANDARD:
        problems.append(f"字段 {key} 不在开放标准里(Claude Code 认的扩展字段,换产品可能报错)")
    md_meta = meta.get("metadata")
    if md_meta is not None and not isinstance(md_meta, dict):
        problems.append("metadata 必须是 key: value 的映射")

    lines = body.count("\n") + 1
    if lines > 500:
        problems.append(f"正文有 {lines} 行,建议不超过 500 行,把细节挪进 references/")

    for target in re.findall(r"\]\(([^)#]+)\)", body):  # 正文里 [文字](相对路径) 指向的文件得存在
        if not target.startswith(("http://", "https://")) and not (skill_dir / target).exists():
            problems.append(f"正文引用的 {target} 不存在")
    return problems


if __name__ == "__main__":
    bad = 0
    for arg in sys.argv[1:]:
        found = check(Path(arg))
        print(f"{'通过' if not found else '有问题'}  {arg}")
        for p in found:
            print(f"    - {p}")
        bad += bool(found)
    sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")` 规范对 `name` 的要求翻成正则:一段小写字母数字,后面可以跟若干个「连字符加一段」。`refund-policy` 匹配;`-pdf`(连字符开头)、`pdf--tool`(连着两个)、`Refund_Policy`(大写和下划线)都不匹配。
- `STANDARD = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}` 开放标准里的六个字段,花括号里没有冒号的是集合(set),相当于 JS 的 `new Set([...])`。
- `def check(skill_dir: Path) -> list[str]:` 返回问题列表,空列表就是通过。每个问题是一句人话,不是错误码。
- `md = skill_dir / "SKILL.md"` `Path` 重载了 `/`,拼路径。
- `if not md.is_file():` 目录里没有 `SKILL.md`,直接返回一个问题,后面的不用查了。
- `meta, body = split_frontmatter(md.read_text(encoding="utf-8"))` 读文件并切开。
- `except ValueError as e:` 接住上面抛的「没有元数据」,把它的消息变成一个问题。
- `problems: list[str] = []` 收集所有问题,不是遇到第一个就停,这样一次能看到全部毛病。
- `name = meta.get("name")` 字典的 `.get` 取不到返回 `None`,不会报 `KeyError`。
- `if not isinstance(name, str) or not name:` `name` 缺失、是嵌套字典或者空字符串,都算「必填」没通过。
- `if len(name) > 64:` 长度上限。
- `if not NAME_RE.fullmatch(name):` `fullmatch` 要求整个字符串匹配。`Refund_Policy` 在这里被拦。
- `if name != skill_dir.name:` `skill_dir.name` 是目录名,`Path("part05/…/refund_Policy").name` 得到 `refund_Policy`,和 `Refund_Policy` 不一样,这是第二个问题。
- `desc = meta.get("description")` 同样的取法。
- `elif len(desc) > 1024:` 描述的上限,`refund-policy` 的是 63,`invoice-title-change` 是 43。
- `for key in meta.keys() - STANDARD:` 字典的 `keys()` 能直接和集合做差集,得到「不在标准里的字段」。`refund-policy` 的是空集;故意写了 `context: fork` 的那个会得到 `{'context'}`。
- `problems.append(f"字段 {key} 不在开放标准里(Claude Code 认的扩展字段,换产品可能报错)")` 这里只提醒,不当成致命错误。Claude Code 的 `context`、`paths` 这些确实有用,只是要知道它们不通用。
- `md_meta = meta.get("metadata")` `metadata` 的值必须是映射。
- `lines = body.count("\n") + 1` 正文行数。数换行符的个数再加 1。
- `if lines > 500:` 规范建议正文不超过 500 行,细节挪进 `references/`。
- `for target in re.findall(r"\]\(([^)#]+)\)", body):` 找正文里 `[文字](路径)` 这种链接的路径。`re.findall` 返回所有第 1 组的内容。`refund-policy` 的正文里有一条:`['references/policy.md']`。
- `if not target.startswith(("http://", "https://")) and not (skill_dir / target).exists():` 不是网址、而且相对 skill 目录找不到,就报「引用的文件不存在」。
- `for arg in sys.argv[1:]:` 命令行可以一次传多个目录。
- `print(f"{'通过' if not found else '有问题'}  {arg}")` 一行结果,问题缩进列在下面。
- `sys.exit(1 if bad else 0)` 有任何一个不通过就用 1 退出,以后能接进 CI,和 [Day 71](/blog/agent-zero/day-071-pytest-1/) 里 pytest 失败时的退出码是同一个约定。

</div>

先检查两个真 skill:

```bash
uv run python -m part05.skills.skill_check .claude/skills/refund-policy .claude/skills/invoice-title-change
```

```text
通过  .claude/skills/refund-policy
通过  .claude/skills/invoice-title-change
```

再故意造四个写错的,每个对应一类毛病。目录放在 `scratch_bad/` 下,练完删掉:

```bash
mkdir -p scratch_bad/{refund_Policy,refund-policy,pdf--tool,no-md}
printf -- '---\nname: Refund_Policy\ndescription:\n---\n正文\n' > scratch_bad/refund_Policy/SKILL.md
printf -- '---\nname: refund-policy\ndescription: 帮助处理退款\ncontext: fork\n---\n看 [规则](references/policy.md) 和 [外链](https://example.com)\n' > scratch_bad/refund-policy/SKILL.md
printf -- '---\nname: pdf--tool\ndescription: 处理 PDF\n---\n正文\n' > scratch_bad/pdf--tool/SKILL.md
printf -- '# 没有元数据\n' > scratch_bad/no-md/SKILL.md
uv run python -m part05.skills.skill_check scratch_bad/refund_Policy scratch_bad/refund-policy scratch_bad/pdf--tool scratch_bad/no-md
echo "exit=$?"
```

<div class="line-notes">

- `mkdir -p scratch_bad/{refund_Policy,refund-policy,pdf--tool,no-md}` 一次建四个目录。第
- `printf -- '---\nname: Refund_Policy` `printf` 比 `echo` 可靠:`\n` 一定是换行。开头的 `--` 告诉 `printf`「后面的 `---` 不是选项」,不然它会把 `---` 当成命令行选项报错。
- `context: fork\n---\n看 [规则](references/policy.md)` 第二个 skill 的名字合规,但多了一个非标准字段,正文还引用了一个不存在的文件。
- `printf -- '---\nname: pdf--tool\n` 第三个测「连续两个连字符」。
- `printf -- '# 没有元数据\n' > scratch_bad/no-md/SKILL.md` 第四个文件根本没有 `---`。
- `echo "exit=$?"` `$?` 是上一条命令的退出码,检查器有任何一个没通过就是 1。

</div>

```text
有问题  scratch_bad/refund_Policy
    - name「Refund_Policy」只能用小写字母、数字和连字符,不能以连字符开头结尾,不能连着两个
    - name「Refund_Policy」和目录名「refund_Policy」不一致
    - description 必填,不能为空
有问题  scratch_bad/refund-policy
    - 字段 context 不在开放标准里(Claude Code 认的扩展字段,换产品可能报错)
    - 正文引用的 references/policy.md 不存在
有问题  scratch_bad/pdf--tool
    - name「pdf--tool」只能用小写字母、数字和连字符,不能以连字符开头结尾,不能连着两个
有问题  scratch_bad/no-md
    - SKILL.md 开头没有用 --- 包起来的元数据
exit=1
```

四个目录一共报出了七个问题。注意第二个目录:`description: 帮助处理退款` 通过了检查,因为它**合法**,只是写得不好,检查器看不出来。格式合规和写得好是两回事,前者能自动查,后者要靠评测去量。明天会写一个小评测来量触发准确率。

## 零件对照表

今天写了这些东西,明天会接着用:

| 文件 | 干什么 | 谁来用 |
| --- | --- | --- |
| `.claude/skills/refund-policy/SKILL.md` | 第二层:什么情况、怎么做、怎么回复 | 模型触发后读 |
| `.claude/skills/refund-policy/references/policy.md` | 第三层:规则原文和例外 | 模型拿不准时读 |
| `.claude/skills/refund-policy/scripts/calc_refund.py` | 第三层:算年付退款金额,只读库 | 模型运行,只看输出 |
| `.claude/skills/refund-policy/scripts/find_duplicates.py` | 第三层:找同日同额的已付发票 | 模型运行,只看输出 |
| `.claude/skills/invoice-title-change/SKILL.md` | 只有第二层的最小 skill | 模型触发后读 |
| `part05/skills/frontmatter.py` | 切开元数据和正文 | 检查器;Day 297 的加载器 |
| `part05/skills/skill_check.py` | 检查 skill 目录合不合规范 | 你,写完 skill 时跑一遍 |
| `part05/skills/mental_math.py` | 让模型心算,和脚本对答案 | 一次性的实验 |

## 动手练习

**练习 1:日期填错了要报错。** 现在传 `--today 2026-10-01`(比账期开始日 2026-10-09 还早),脚本会算出「用了 0 个月、可退 12 个月、7176 元」。这显然是日期填错了。给 `calc_refund.py` 加一道检查:今天早于账期开始日就报错退出。

<details><summary>参考答案</summary>

先看现状。没有这道检查,日期填成账期开始之前,脚本不吭声地给出全额:

```bash
uv run python .claude/skills/refund-policy/scripts/calc_refund.py C023 --today 2026-10-01
```

```text
{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0091", "period": "2026-10-09 ~ 2027-10-09", "months_used": 0, "months_refundable": 12, "refund_yuan": 7176.0, "rule": "2"}
```

在 `start = minus_one_year(end)` 和 `used = months_used(start, today)` 之间插四行:

```python
    start = minus_one_year(end)
    if today < start:  # 今天比账期开始还早,日期多半填错了
        out({**base, "error": f"今天 {today} 早于本期账期开始日 {start},日期是不是填错了"})
        return 1
    used = months_used(start, today)
```

<div class="line-notes">

- `start = minus_one_year(end)` 原来就有的一行,当锚点。C023 的 `start` 是 `2026-10-09`。
- `if today < start:` 两个 `date` 对象可以直接比大小。`2026-10-01 < 2026-10-09` 为真。
- `out({**base, "error": f"今天 {today} 早于本期账期开始日 {start},日期是不是填错了"})` 沿用「出错就输出带 `error` 字段的 JSON」的约定,`SKILL.md` 里「脚本报错时把错误原样告诉客服」这条正好管到它。
- `return 1` 退出码 1,和「找不到客户」「发票未付款」一类。
- `used = months_used(start, today)` 原来就有的一行。检查通过才走到这里。

</div>

我是在脚本的副本上改的,用环境变量指到同一个库。三个日期的结果:

```text
{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "invoice_id": "INV-2026-0091", "period": "2026-10-09 ~ 2027-10-09", "months_used": 1, "months_refundable": 11, "refund_yuan": 6578.0, "rule": "2"}
{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "error": "今天 2026-10-01 早于本期账期开始日 2026-10-09,日期是不是填错了"}
{"customer_id": "C023", "plan": "企业版", "billing_cycle": "yearly", "error": "今天 2025-12-31 早于本期账期开始日 2026-10-09,日期是不是填错了"}
```

10-23 照常算出 6578;10-01 和 2025-12-31 都被拦住。注意**不要**顺手把「今天晚于账期结束」也拦掉:账期过了的订阅,`months_used` 会超过 12,`max(0, 12 - used)` 会把剩余月数收回 0,算出来是 0 元,这是对的。

</details>

**练习 2:自己写第三个 skill。** 写一个 `two-factor-reset`:客户换了手机收不到验证码,要关掉两步验证。要求有 `SKILL.md` 和一个 `references/steps.md`,正文里引用它,用 `skill_check` 检查通过;再把 `name` 改成 `Two-Factor-Reset`,看检查器怎么报。(流程是我为云簿编的演示规则。)目录放在 `part05/skills/ex_skills/`,不放进 `.claude/skills/`,免得明天它混进目录影响数字。

<details><summary>参考答案</summary>

`part05/skills/ex_skills/two-factor-reset/SKILL.md`:

```markdown
---
name: two-factor-reset
description: 帮客户关闭或重置两步验证。客户说换了手机验证码收不到、两步验证登不上、要关掉两步验证时使用。
---

# 两步验证重置

1. 先核实身份:客户要在工单里写出注册邮箱,和最近一张已付发票的发票号后四位。两项都对得上才继续,对不上就停下,不要透露哪一项错了。
2. 身份核实通过后,告诉客户:重置会在 24 小时后生效,期间登录会收到提醒邮件。
3. 不要在回复里写出验证码、恢复码的任何内容。
4. 客户拒绝提供发票号后四位的,转人工,不要自己放行。

具体话术和例外见 [references/steps.md](references/steps.md)。
```

<div class="line-notes">

- `name: two-factor-reset` 和目录名一致,全小写加连字符。
- `description: 帮客户关闭或重置两步验证。` 前半句做什么,后半句列客户的说法:「换了手机验证码收不到」「两步验证登不上」「要关掉两步验证」。
- `1. 先核实身份:` 流程里最重要的一步放第一条。「对不上就停下,不要透露哪一项错了」是安全习惯:告诉攻击者「邮箱对了、发票号错了」等于帮他缩小范围。
- `3. 不要在回复里写出验证码、恢复码的任何内容。` 「不要做」的条目,模型踩过才知道要写。
- `4. 客户拒绝提供发票号后四位的,转人工,不要自己放行。` 把「拿不准就转人工」写成明文规则,别让模型自己拿主意。
- `具体话术和例外见 [references/steps.md](references/steps.md)。` 第三层入口。话术和例外不是每次都要,放在文件里,用到才读。

</div>

`references/steps.md`:

```markdown
# 话术和例外

- 核实通过:「已为你提交重置,24 小时后生效,期间登录会收到提醒邮件。」
- 核实失败:「暂时无法确认你的身份,请联系账号管理员或转人工客服。」
- 例外:企业版客户由账号管理员代为申请,个人不能自己重置。
```

检查,和把名字改错之后再检查:

```bash
uv run python -m part05.skills.skill_check part05/skills/ex_skills/two-factor-reset
sed -i '' 's/^name: two-factor-reset/name: Two-Factor-Reset/' part05/skills/ex_skills/two-factor-reset/SKILL.md
uv run python -m part05.skills.skill_check part05/skills/ex_skills/two-factor-reset
sed -i '' 's/^name: Two-Factor-Reset/name: two-factor-reset/' part05/skills/ex_skills/two-factor-reset/SKILL.md
```

<div class="line-notes">

- `uv run python -m part05.skills.skill_check part05/skills/ex_skills/two-factor-reset` 第一次检查,通过。
- `sed -i '' 's/^name: two-factor-reset/name: Two-Factor-Reset/'` macOS 的 `sed -i` 需要给一个空的备份后缀 `''`;Linux 上不用写它。`^` 表示行首,只改 `name:` 那一行。
- `uv run python -m part05.skills.skill_check part05/skills/ex_skills/two-factor-reset` 改坏之后第二次检查,有两个问题。
- `sed -i '' 's/^name: Two-Factor-Reset/name: two-factor-reset/'` 改回来,别忘了。

</div>

```text
通过  part05/skills/ex_skills/two-factor-reset
有问题  part05/skills/ex_skills/two-factor-reset
    - name「Two-Factor-Reset」只能用小写字母、数字和连字符,不能以连字符开头结尾,不能连着两个
    - name「Two-Factor-Reset」和目录名「two-factor-reset」不一致
```

名字改成带大写以后,一条改动触发了两个问题:格式不合规,以及和目录名对不上。

</details>

**练习 3:查「正文提到的文件存在不存在」。** 现在的 `skill_check` 只检查 `[文字](路径)` 形式的链接。但 `refund-policy` 的正文里提到脚本用的是反引号:`` `uv run python .claude/skills/refund-policy/scripts/find_duplicates.py <客户ID>` ``。给检查器加一条规则:正文里反引号包着的 `scripts/xxx`、`references/xxx`、`assets/xxx`,对应文件必须存在。不要改 `skill_check.py`,新写一个文件调用它。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/skills/ex296_check_refs.py
"""练习 3:正文里用反引号提到的 scripts/ 和 references/ 文件,必须真的存在。用法:uv run python -m part05.skills.ex296_check_refs <skill 目录>..."""
import re
import sys
from pathlib import Path

from part05.skills.frontmatter import split_frontmatter
from part05.skills.skill_check import check

BACKTICK_PATH = re.compile(r"`[^`\n]*?((?:scripts|references|assets)/[\w./-]+)[^`\n]*`")


def check_refs(skill_dir: Path) -> list[str]:
    _, body = split_frontmatter((skill_dir / "SKILL.md").read_text(encoding="utf-8"))
    return [f"正文提到了 {rel},但文件不存在"
            for rel in dict.fromkeys(BACKTICK_PATH.findall(body))  # dict.fromkeys 去重并保持顺序
            if not (skill_dir / rel).exists()]


if __name__ == "__main__":
    bad = 0
    for arg in sys.argv[1:]:
        d = Path(arg)
        problems = check(d) or check_refs(d)  # 基础检查没过就不往下查了
        print(f"{'通过' if not problems else '有问题'}  {arg}")
        for p in problems:
            print(f"    - {p}")
        bad += bool(problems)
    sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `BACKTICK_PATH = re.compile(r"`[^`\n]*?((?:scripts|references|assets)/[\w./-]+)[^`\n]*`")` 找「一对反引号,里面某处出现 `scripts/`、`references/` 或 `assets/` 开头的路径」。第 1 组只捕获那个路径。`[^`\n]*?` 是「不含反引号和换行的任意字符,尽量少」,保证不会跨出这一对反引号。
- `def check_refs(skill_dir: Path) -> list[str]:` 和 `check` 一样返回问题列表。
- `_, body = split_frontmatter(` 复用明天也要用的解析函数。元数据用不上,用 `_` 丢掉。
- `return [f"正文提到了 {rel},但文件不存在"` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),每个不存在的路径一条问题。
- `for rel in dict.fromkeys(BACKTICK_PATH.findall(body))  # dict.fromkeys 去重并保持顺序` `findall` 找到的路径可能重复(同一个脚本在正文里提了两次),`dict.fromkeys` 一边去重一边保持出现顺序。对 `refund-policy`,结果是 `calc_refund.py` 和 `find_duplicates.py` 两个脚本。
- `if not (skill_dir / rel).exists()]` 路径相对 skill 目录,不存在才报。
- `problems = check(d) or check_refs(d)  # 基础检查没过就不往下查了` `or` 的短路:`check(d)` 返回非空列表(有问题)就直接用它,是空列表才去算后面。基础格式都不对时,往下查文件引用没意义。

</div>

跑三次:原样、删掉 `find_duplicates.py`、恢复:

```bash
uv run python -m part05.skills.ex296_check_refs .claude/skills/refund-policy
mv .claude/skills/refund-policy/scripts/find_duplicates.py /tmp/fd.bak
uv run python -m part05.skills.ex296_check_refs .claude/skills/refund-policy
mv /tmp/fd.bak .claude/skills/refund-policy/scripts/find_duplicates.py
```

```text
通过  .claude/skills/refund-policy
有问题  .claude/skills/refund-policy
    - 正文提到了 scripts/find_duplicates.py,但文件不存在
```

(我实测时备份放在自己的临时目录里;你随便放哪都行,记得放回去。)原来的 `skill_check` 对这个 skill 报「通过」,因为它只看 `[文字](路径)` 形式的链接。**一个检查器查的是你让它查的东西**,写 skill 越多,越会发现要给检查器补规则。

</details>

**练习 4:把脚本的答案固化成测试。** 脚本的好处是结果可以测。用 pytest 写 `tests/test_calc_refund.py`:参数化覆盖 12 个客户日期组合里的 7 个能退钱的,四种不退的规则,「本期发票未付」和「找不到客户」。再做一个变异实验:把脚本里的修复(取最新发票再判状态)改回第一版的 bug,测试能不能抓到。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_calc_refund.py
"""练习 4:把退款脚本的结果固化成测试。脚本不是模块,用子进程跑它,和 Agent 调它的方式一样。"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / ".claude/skills/refund-policy/scripts/calc_refund.py"


def run(customer: str, today: str) -> tuple[int, dict]:
    r = subprocess.run([sys.executable, str(SCRIPT), customer, "--today", today], capture_output=True, text=True)
    return r.returncode, json.loads(r.stdout)


@pytest.mark.parametrize(("customer", "today", "months", "yuan"), [
    ("C023", "2026-10-23", 11, 6578.0),
    ("C023", "2026-11-08", 11, 6578.0),  # 差一天满一个月,还算第一个月
    ("C023", "2026-11-09", 10, 5980.0),  # 满一个月,第二个月开始
    ("C023", "2027-03-15", 6, 3588.0),
    ("C023", "2027-10-01", 0, 0.0),  # 最后一个月,没有可退的
    ("C005", "2026-10-23", 11, 13068.0),
    ("C028", "2026-10-23", 11, 39468.0),
])
def test_yearly_refund(customer: str, today: str, months: int, yuan: float) -> None:
    code, data = run(customer, today)
    assert code == 0
    assert data["months_refundable"] == months
    assert data["refund_yuan"] == yuan


@pytest.mark.parametrize(("customer", "rule"), [
    ("C009", "2"),  # 基础版年付不退
    ("C007", "3"),  # 月付
    ("C026", "例外"),  # 试用中
    ("C030", "例外"),  # 已取消
])
def test_zero_refund_rules(customer: str, rule: str) -> None:
    code, data = run(customer, "2026-10-23")
    assert code == 0
    assert data["refund_yuan"] == 0
    assert data["rule"] == rule


def test_unpaid_invoice_is_error_not_last_years_money() -> None:
    code, data = run("C013", "2026-10-23")  # 本期发票 open,去年那张 paid 不能拿来算
    assert code == 1
    assert "error" in data
    assert "refund_yuan" not in data


def test_unknown_customer() -> None:
    code, data = run("C999", "2026-10-23")
    assert code == 1
    assert "C999" in data["error"]
```

<div class="line-notes">

- `SCRIPT = Path(__file__).resolve().parents[1] / ".claude/skills/refund-policy/scripts/calc_refund.py"` 测试文件在 `tests/` 下,`parents[0]` 是 `tests`,`[1]` 是仓库根。
- `def run(customer: str, today: str) -> tuple[int, dict]:` 脚本不是能 `import` 的模块(目录名带连字符、也不该被当库用),用子进程跑它,和 Agent 调它的方式一模一样,顺便把退出码和输出一起拿到。
- `r = subprocess.run([sys.executable, str(SCRIPT), customer, "--today", today], capture_output=True, text=True)` 这次没有 `check=True`:有的用例就是要测「脚本以 1 退出」。
- `return r.returncode, json.loads(r.stdout)` 返回 `(退出码, 解析后的 JSON)`。
- `@pytest.mark.parametrize(("customer", "today", "months", "yuan"), [` 参数化([Day 73](/blog/agent-zero/day-073-pytest-3/)):下面每一行是一组参数,生成一条独立的测试。
- `("C023", "2026-11-08", 11, 6578.0),  # 差一天满一个月,还算第一个月` 边界用例。`2026-11-09` 就是 10 个月、5980 元(`717600 × 10 // 12 = 598000` 分)。
- `("C023", "2027-10-01", 0, 0.0),  # 最后一个月,没有可退的` 另一个边界:剩 0 个月,0 元。
- `assert data["refund_yuan"] == yuan` 金额是 `657800 / 100`,浮点比较在这里没问题,因为分换算成元的结果正好能被精确表示;更稳妥的写法是 `pytest.approx`。
- `("C026", "例外"),  # 试用中` 不同的不退原因对应不同的 `rule`。
- `def test_unpaid_invoice_is_error_not_last_years_money() -> None:` 把第三步那个 bug 钉成测试。函数名就是说明书。
- `assert "refund_yuan" not in data` 报错的时候**不能**同时带着一个金额,否则模型可能把金额当结论。
- `assert "C999" in data["error"]` 报错信息里要有客户编号,出了问题好找。

</div>

跑通:

```bash
uv run pytest tests/test_calc_refund.py -v
```

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0 -- /Users/你/agent-zero-lab/.venv/bin/python
cachedir: .pytest_cache
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
plugins: anyio-4.15.1
collecting ... collected 13 items

tests/test_calc_refund.py::test_yearly_refund[C023-2026-10-23-11-6578.0] PASSED [  7%]
tests/test_calc_refund.py::test_yearly_refund[C023-2026-11-08-11-6578.0] PASSED [ 15%]
tests/test_calc_refund.py::test_yearly_refund[C023-2026-11-09-10-5980.0] PASSED [ 23%]
tests/test_calc_refund.py::test_yearly_refund[C023-2027-03-15-6-3588.0] PASSED [ 30%]
tests/test_calc_refund.py::test_yearly_refund[C023-2027-10-01-0-0.0] PASSED [ 38%]
tests/test_calc_refund.py::test_yearly_refund[C005-2026-10-23-11-13068.0] PASSED [ 46%]
tests/test_calc_refund.py::test_yearly_refund[C028-2026-10-23-11-39468.0] PASSED [ 53%]
tests/test_calc_refund.py::test_zero_refund_rules[C009-2] PASSED         [ 61%]
tests/test_calc_refund.py::test_zero_refund_rules[C007-3] PASSED         [ 69%]
tests/test_calc_refund.py::test_zero_refund_rules[C026-\u4f8b\u5916] PASSED [ 76%]
tests/test_calc_refund.py::test_zero_refund_rules[C030-\u4f8b\u5916] PASSED [ 84%]
tests/test_calc_refund.py::test_unpaid_invoice_is_error_not_last_years_money PASSED [ 92%]
tests/test_calc_refund.py::test_unknown_customer PASSED                  [100%]

============================== 13 passed in 1.01s ==============================
```

变异实验:临时把脚本里取发票的那一句改回第一版的写法(加上 `AND status = 'paid'`),再跑一次,然后改回来:

```bash
sed -i '' "s/WHERE subscription_id = ? ORDER BY issued_at DESC LIMIT 1/WHERE subscription_id = ? AND status = 'paid' ORDER BY issued_at DESC LIMIT 1/" .claude/skills/refund-policy/scripts/calc_refund.py
uv run pytest tests/test_calc_refund.py -q
```

```text
...........F.                                                            [100%]
=================================== FAILURES ===================================
______________ test_unpaid_invoice_is_error_not_last_years_money _______________

    def test_unpaid_invoice_is_error_not_last_years_money() -> None:
        code, data = run("C013", "2026-10-23")  # 本期发票 open,去年那张 paid 不能拿来算
>       assert code == 1
E       assert 0 == 1

tests/test_calc_refund.py:49: AssertionError
=========================== short test summary info ============================
FAILED tests/test_calc_refund.py::test_unpaid_invoice_is_error_not_last_years_money
1 failed, 12 passed in 1.10s
```

另外 12 条全绿,只有「未付发票」那一条红了:修复被改回去,测试立刻抓住。再改回来跑一次,13 条全通过。**只有当你亲手把修复改坏、看见测试变红,才知道这条测试真的在守着那个 bug**,否则它可能永远是绿的,什么也没守。

</details>

**验收标准**:`skill_check` 对两个真 skill 报通过,对四个故意写错的报七个问题;`calc_refund.py` 对 C023 / C005 / C028 在 `--today 2026-10-23` 得到 6578.0 / 13068.0 / 39468.0;`mental_math.py` 直接报数 3/12、写步骤 12/12;`pytest` 13 条通过;你能讲出为什么「有唯一答案的计算」要放脚本、「description 写得差」为什么检查器查不出来。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Agent Skills | 扩展 Agent 的开放格式:一个带 `SKILL.md` 的文件夹,可以附带参考文件和脚本。2025 年 12 月作为开放标准发布在 agentskills.io |
| `SKILL.md` | skill 的入口文件:开头的元数据(`name`、`description` 等)加后面的 Markdown 正文 |
| frontmatter | Markdown 文件开头用 `---` 包起来的一小段元数据,格式是 YAML |
| YAML | 一种用缩进表示层级的数据格式,可以想成「不写花括号和引号的 JSON」 |
| 渐进式披露(progressive disclosure) | 信息分层、按需加载:先给目录,用到再给正文,再用到才给参考文件 |
| `description` | skill 的描述,启动时就放进上下文,模型靠它决定要不要用这个 skill |
| `scripts/`、`references/` | skill 目录里放脚本和参考文档的约定子目录,里面的东西第三层才读 |
| `allowed-tools` | 元数据里的实验性字段,声明 skill 预先批准使用哪些工具,各家支持不一 |
| 退出码(exit code) | 程序结束时告诉调用方成败的数字:0 成功,非 0 失败。`sys.exit(1)` 设置它,shell 里 `$?` 读取它 |
| 变异实验 | 故意把代码改坏,看测试会不会变红,用来检验测试是不是真的在守东西 |
| 参数化(parametrize) | pytest 里用一份测试函数加一张参数表,生成多条用例 |

## 常见误区

**把 skill 当成更长的 system prompt。** skill 的价值在「不用时不占地方」。如果只有一两套规则、每个请求都要用,直接写进 system prompt 更简单,还少了读文件的往返。skill 适合「很多套、每次只用其中一两套」的场景。

**description 写得很短很抽象。** 模型是看 description 决定用不用的。「帮助处理退款」检查器放得过去,但模型分不清它和其他 skill 的边界。写完用十个真实问题测触发率,明天会写这个评测。

**让模型心算有唯一答案的数。** 第五步实测:直接报数 12 题对 3 题(对的全是答案为 0 的),写步骤能 12 对 12 但输出多了 130 倍的 token,单次花费高 7 倍。金额、日期、税率写成脚本,模型只读结果。

**脚本悄悄给出一个看着合理的错数。** 第一版取「最近一张已付款发票」,本期没付钱时翻出了去年的发票,算出「可退 1089 元」,没有任何报错。脚本遇到数据不对,要明确报错并说出原因,别在不确定时硬给一个数。

**以为 Claude Code 的扩展字段到处都能用。** `context`、`paths`、`disable-model-invocation` 只有 Claude Code 认,上传到别的产品可能报错;字段名拼错在 Claude Code 里是静默忽略。跨产品用的 skill 只写标准字段,并用检查器看一遍。

**name 和目录名不一致。** 规范要求相同。有的客户端会直接跳过这样的 skill,不提示。

**把「合规」当成「写得好」。** `skill_check` 能查格式,查不出 description 有没有写清触发场景、正文有没有歧义。后者只能靠评测。

**规则复制了好几份。** 退款规则同时在 system prompt、知识库、skill 里各有一份,改的时候漏一份,模型就会按旧的说。规则只维护一个源文件。

## 学习资料

### 文档与文章

- [Agent Skills 规范](https://agentskills.io/specification):格式的权威定义,字段约束、目录约定、三层加载的建议数字都在这里,20 分钟读完。
- [Claude 文档 · Agent Skills 概览](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview):三层加载的 token 表、在不同产品里怎么用,30 分钟。
- [Claude Code 文档 · Skills](https://code.claude.com/docs/en/skills):存放位置、扩展字段、description 的字数预算,写给 Claude Code 用的 skill 时当手册查。
- [Anthropic 工程博客 · Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills):Anthropic 对设计思路的说明,15 分钟。
- [Simon Willison · Agent Skills](https://simonwillison.net/2025/Dec/19/agent-skills/):开放标准发布时的评论,讲为什么「文件夹加 Markdown」的形式容易普及,10 分钟。
- [OpenAI · Codex 构建 Skills](https://learn.chatgpt.com/docs/build-skills):Codex 里的目录约定(`.agents/skills`),和 Claude Code 的对照着看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14QPvzuEUR&autoplay=0&high_quality=1" title="Claude Code的设计哲学：渐进式披露" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>第四种黑猩猩CHIMP · Claude Code的设计哲学:渐进式披露 · 7 分钟,把「为什么分层加载」讲得很清楚,适合先看。</figcaption>
</figure>

- 大梁Max《保姆级Skill通关指南,系统了解Skill是什么,让Agent再好用百倍!》(BV1QuJ16aEhy,16 分钟):偏使用者视角,讲 skill 在日常工作里怎么用。
- 图灵AI大模型《面试官:Agent架构中的Skill是什么?渐进式披露是如何实现的?》(BV1prG76HEGj,6 分钟):面试题讲法,可以和明天的「Skills 和 MCP 怎么选」对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CEvIs9y1uog" title="Don't Build Agents, Build Skills Instead" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Don't Build Agents, Build Skills Instead – Barry Zhang & Mahesh Murag, Anthropic · 英文,开字幕。Skills 的设计者讲为什么是「通用 Agent 加一堆 skill」,而不是一个个专用 Agent。</figcaption>
</figure>

- AI Engineer《Building Great Agent Skills: The Missing Manual》(YouTube `UNzCG3lw6O0`,英文):写 skill 的实践经验,description 怎么写、正文多长合适。

### 书籍

今天这组不需要。Skills 是 2025 年下半年才出现的东西,我没有找到专门讲它的正式出版书籍,以上面的规范和官方文档为准。

### 开源项目与代码

- [anthropics/skills](https://github.com/anthropics/skills):Anthropic 官方的 skill 仓库,包括文档类 skill 和 skill-creator,看别人的 `SKILL.md` 怎么组织,1 小时。
- [agentskills/agentskills](https://github.com/agentskills/agentskills):规范本身和 `skills-ref` 校验工具。
- [openai/skills](https://github.com/openai/skills):OpenAI 给 Codex 整理的 skill 目录,和 Anthropic 的对照着看。

## 自测

1. skill 的三层分别是什么?各自什么时候进上下文?

<details><summary>答案</summary>

第一层是所有 skill 的 `name` 和 `description`,启动时就放进上下文,一直在;第二层是某个 skill 的 `SKILL.md` 正文,模型判断要用这个 skill 时才读进来;第三层是 `references/` 里的参考文件和 `scripts/` 里的脚本,正文让读、而且任务确实需要时才读,脚本只有运行输出进上下文,源码不进。

</details>

2. 下面这个 frontmatter 有几处不合规范?`name: Refund_Policy`,目录叫 `refund-policy`,`description` 后面是空的。

<details><summary>答案</summary>

三处。`name` 有大写字母和下划线(只能用小写字母、数字和连字符);`name` 和目录名不一致;`description` 必填且不能为空。检查器对这个 skill 会报前两处是 name 的问题,第三处是 description 的问题。

</details>

3. 退款金额为什么写成脚本,而不是在 `SKILL.md` 里写公式让模型算?

<details><summary>答案</summary>

金额有唯一正确答案,出错的代价是钱。实测让模型直接报数,12 题只对 3 题(对的全是答案为 0 的);允许先写步骤能 12 对 12,但输出 token 多了 130 倍、花费高 7 倍,而且每次都要付。脚本是确定性的、结果可以写测试、源码不进上下文,输出只有一行 JSON。模型负责判断属于哪种情况、怎么跟客户解释,计算交给代码。

</details>

4. 第一版脚本取「最近一张已付款的发票」,为什么会算错?怎么改的?

<details><summary>答案</summary>

C013 本期发票 `INV-2026-0050` 是 `open`(还没付),`status = 'paid'` 的过滤把它跳过,翻出了去年已付的 `INV-2026-0051`,算出「可退 1089 元」,没有任何报错。修法是先取最新的一张(不管状态),再判断状态是不是 `paid`,不是就报错。教训:数据不对时要报错并说明原因,不要在不确定时给一个看着合理的数。

</details>

5. (面试题)「你们的客服 Agent 有退款、发票、两步验证等一二十套业务规则,全写在 system prompt 里。你会怎么改?」

<details><summary>答案</summary>

拆成 skill。每套规则一个文件夹,`SKILL.md` 写做法,细节规则放 `references/`,确定性的计算写成 `scripts/`。启动时只让模型看到每个 skill 的名字和一句描述(约 100 token 一个),相当于路由表,用到哪个才读正文。好处有三:不相关的规则不占上下文、不花钱;规则分文件管理,改动走代码评审;计算交给脚本,可以测试。代价是要有读文件和跑脚本的能力(Claude Code 这类产品自带,自己的 Agent 要实现),要给每个 skill 的触发准确率写评测,以及 description 要写好。如果只有一两套规则、每个请求都要用,直接写进 system prompt 更简单。

</details>

6. `skill_check` 对 `description: 帮助处理退款` 报通过,这是不是检查器的 bug?

<details><summary>答案</summary>

不是。它符合格式要求(非空、不超过 1024 字符),只是写得不好:没写清什么时候用,模型难以把它和别的 skill 区分开。格式合规能自动查,写得好不好要靠评测去量,比如准备十个该触发和十个不该触发的问题,看第一步选对了没有。

</details>

## 明天预告

Day 297 · Agent Skills(二):在 Claude Code 里跑,在自己的循环里实现加载器。今天写好了两个 skill 和一个检查器,但还没有模型真正用过它们。明天先用 Claude Code 自带的能力让它自动发现并触发 `refund-policy`(关在假目录里跑),再在自己的 Agent 循环里写一个 80 行的加载器,让 DeepSeek 也能用同一个 skill 文件夹,并且量出三层加载比「把所有 skill 塞进 system prompt」到底省多少 token。
