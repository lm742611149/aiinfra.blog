# agent-zero · AI Agent 工程师:从零到资深 · 写作规范

所有写手动笔前读完本文件。逐日内容以 `docs/agent-zero-outline.md` 第 2 节为准(标题、slug、知识点、来源、要实跑的东西都在那张表里);旧课 `src/content/blog/agent-60/` 是素材库,大纲「来源」列写了从哪篇哪节拆。

## 0. 读者和目标

- **读者只会前端**(HTML/CSS/JS/TS/React、npm、DevTools),其他全部 0 基础:不会 Python,没写过后端,不懂 HTTP 服务端、数据库和 SQL、Linux、Docker、git 命令行,也不懂机器学习。站长本人会从 Day 0 开始一天天学,网站以他自学为主,**越细越好,宁可多讲,不可跳步**。
- 前端知识不教、不解释;涉及界面的课只讲 Agent 相关部分。
- 终点和旧课一样:普通篇学完能投 AI Agent 工程师岗,进阶篇对准资深,作品篇产出两个能在线试用的作品。
- 诚实:不编运行输出、不编数字、不编书和链接;二手来源标明。

## 1. 文件与 frontmatter

- 路径:`src/content/blog/agent-zero/day-NNN-<slug>.md`,NNN 三位数,slug 用大纲里的。
- frontmatter(`draft: true` 必须有,全部写完统一切换上线前不要去掉):

```yaml
---
title: 'Day N · 标题'          # 和大纲一致,以「Day N · 」开头(N 不补零)
description: '一两句话。'
pubDate: 2026-10-22            # 写作当天的真实日期(date +%F),不能是未来
regime: none
tags: ['python', 'agent-zero']  # 最后一个固定 'agent-zero'
series: 'agent-zero'
day: N
lang: 'zh'
draft: true
---
```

- 站内链接:`/blog/agent-zero/day-NNN-slug/`。引用前面学过的内容一律链接到新课的那一天,不要链接旧课 agent-60。

## 2. 每篇骨架(`##` 二级标题,顺序固定)

1. `## 上一课回顾`(Day 0 没有这节):三五句,说上一课学了什么、今天为什么接着学这个。
2. `## 今天要解决的问题`:学完要会的 2–4 条可验证目标 + 预计用时(1.5–3 小时)+ 前置(依赖哪几天)。
3. 正文若干节:一步一个可跑脚本,讲为什么 → 代码 → line-notes → 真实输出 → 小结。
4. `## 动手练习`:每道题后面紧跟参考答案(见 0 基础规则第 11 条),最后写验收标准。
5. `## 名词解释`:表格「名词 | 意思」,当天第一次出现的术语都要进表。
6. `## 常见误区`:每条加粗一句开头再解释,优先写真实踩过的坑和真实报错。
7. `## 学习资料`:五个三级标题 `### 文档与文章` `### B 站视频` `### 其他经典视频` `### 书籍` `### 开源项目与代码`(某组确实没有写「今天这组不需要」,但文档和视频两组每篇必须有)。0 基础的天优先选中文、入门、短的资料。
8. `## 自测`:4–6 题,答案放 `<details><summary>答案</summary>`(summary 后与 `</details>` 前各空一行);从第三部分起每篇至少 1 道「面试题」。
9. `## 明天预告`:写下一天标题的关键词(或 `Day N+1`)和为什么紧接今天。最后一天写「没有 Day N+1 了」。

**复习日**骨架同上,正文换成:本周知识地图(一张 SVG 或表)→ 本周每天一句话回顾并链接 → 一个只用本周知识的小练习或小项目(完整参考答案)→ 本周错题与坑清单。

## 3. 0 基础规则(优先级最高)

1. **读者只会前端**:Python 语法和工具一律给 JS/TS 对照(一句「相当于 JS 里的 …」或一张小对照表,比如 list≈Array、dict≈Object/Map、async/await 对照 Promise、uv≈npm/pnpm、pyproject.toml≈package.json、.venv≈node_modules、pytest≈jest/vitest);后端、数据库、运维概念从前端看得到的现象讲起(DevTools 里的请求在服务端怎么被处理),再讲原理;数学和统计先给直觉和能跑的模拟,公式放最后。
2. **术语第一次出现就解释**:一句大白话 + 一个具体例子,并进当天「名词解释」。前面某天学过的术语,在新的一天第一次用到时给一句提醒并链接到它首次出现的那一天。
3. **一天最多两个新概念**:标题写什么就只讲什么;塞不下就在汇报里提出拆天,不压缩。
4. **一步一个可跑脚本**:新概念先用 10–30 行、不花钱或只花几分钱的最小脚本演示,跑出真实输出;每一步只比上一步多一个新东西;大代码放在最后拼,并附「零件 → 大代码哪一段」对照表。
5. **每段代码都有 line-notes**:按 `docs/course-writing-guide-agent.md` 3.1 节的格式,逐行(至少每个有意义的行)解释,代入实跑出来的具体值;跑不了的(没 key、要 GPU、要付费账号)写明「这段没实跑」和原因。
6. **不跳步**:命令写全(在哪个目录跑、先装什么);文件路径写全;每个依赖写出 `uv add` 那一行;用到前面某天建的文件时写清「这是 Day N 建的 xxx.py」。
7. **报错先演示一次**:常见坑故意制造一次,贴真实报错原文,再讲怎么修。
8. **用时写实**:1.5–3 小时,复习日和项目日可到 4 小时。
9. **长度讲透为止**:不设上下限,长来自例子、输出和逐行讲解,不来自多塞概念。
10. **学法**:每篇「今天要解决的问题」末尾固定一句学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。
11. **每道练习都有参考答案**:放在题目后 `<details><summary>参考答案</summary>`;代码完整可跑,带 line-notes(代入实跑数据)和真实输出;「观察会发生什么」类题贴实跑现象 + 一句解释;开放题给一个示范解法 + 实跑前后对比。

## 4. 语气、图、视频、链接

沿用 `docs/course-writing-guide-agent.md`:3.0 节(人类语气硬规则、禁用词)、3.1 节(line-notes 格式,key 按顺序匹配代码行)、4.1 节(内联 SVG 只用站点 token,每篇 1–3 张)、4.2 节(视频每篇 2–4 个、B 站至少 1 个,用 view API / oEmbed 验证)、4.3 节(外链逐个 curl,书必须真实存在)。0 基础部分多用图:一个概念一张示意图比三段文字好。

## 5. 技术栈与练习仓库

- 技术栈同旧课第 1 节(Python 3.12 + uv、openai SDK 走 OpenAI 兼容协议、默认 DeepSeek、pgvector、MCP 官方 SDK、LangGraph、Langfuse、FastAPI)。**所有版本号、模型名、价格写之前当场查**(PyPI/官方文档),写「2026 年 10 月查到」。
- 新课练习仓库叫 `agent-zero-lab/`(和旧课的 agent-60-lab 无关),结构:
  - `common/`:跨部分复用的模块(如 `common/llm.py` 的 LLMClient、`common/cost.py`),哪天建、哪天改按大纲;
  - `partNN/`:每部分一个目录(`part01/` … `part12/`),文件名按主题起,代码块第一行注释写完整路径,如 `# agent-zero-lab/part03/agent_loop.py`;
  - `cloudledger/`:虚构 SaaS 公司「云簿 CloudLedger」的数据(帮助中心文章、customers/subscriptions/invoices/tickets 表、seed 脚本),旧课 Day 23 的 `w4/cloudledger/seed.py` 是蓝本;在大纲指定的那天首次建,之前的天要数据就在脚本里写几行小样本;
  - 毕业项目和作品各自独立仓库:`supportpilot/`、`agentops/`、`agent-loupe/`、`billsleuth/`。
- 练习仓库建法(Day 10):`uv init --no-package agent-zero-lab --python 3.12`(uv 0.12 起默认是带 src/ 的打包项目,必须加 --no-package),仓库在 `~/agent-zero-lab`,脚本从仓库根目录运行。
- 旧课代码搬过来时,改成新目录和新导入路径,改完要实跑。

### 5.1 共享模块的接口约定(所有写手必须一致)

- `common/llm.py` 在 Day 135–137 建,**唯一蓝本是旧课 `~/Documents/agent-60-lab/common/llm.py`**(只读参考,复制到自己的 scratchpad 用):`LLMClient(env_file=None, **overrides)`;`chat(messages, **kw) -> ChatResult`(kw 透传给 openai,如 `tools`、`response_format`、`temperature`);`stream(messages, **kw)` 逐段产出文本;`ChatResult` 字段 `content / reasoning / finish_reason / message / prompt_tokens / completion_tokens / cache_hit_tokens / cost(元) / latency / ttft`;`client.ledger` 是 `Ledger(calls, prompt_tokens, completion_tokens, cost)`;同文件还有 `Conversation(system, max_turns)`。Day 135 之前的课不能用它,直接用 openai SDK 或纯 Python。后面某天要给它加东西(大纲写了的,如 Day 457),就在那天讲清加了什么。
- `common/embed.py`(Day 217 建):`embed(texts)`、`embed_one(text)`、`cosine(a, b)`、模块级 `usage` 字典;import 它的脚本在 `agent-zero-lab` 根目录用 `uv run python -m partNN.xxx` 跑。
- CloudLedger MCP server(第五部分):`agent-zero-lab/cloudledger/server.py`(和 `seed.py` 同目录),四个工具名固定为 `find_customer`、`get_subscription`、`list_invoices`、`create_refund_request`(和旧课一致;大纲里写 `get_customer` 的以此为准)。
- 天气 CLI(Day 70 建,Day 74–76 依赖):`part01/weather_cli.py` 含 `GEO_URL`、`FORECAST_URL`、`WeatherError`、`geocode(...)`、`current_temp(...)`、`get_weather(client, city)`、`main(cities)`,用 Open-Meteo 免费接口;Day 74 再把 client 参数改成 `HttpClient` Protocol、超时读 `WEATHER_TIMEOUT`。
- `common/structured.py`(Day 150 建):`ChatClient`(Protocol)、`ExtractionError`、`schema_prompt(...)`、`extract(...)`(pydantic 校验+带错误重试)。DeepSeek 官方不支持 `json_schema`,需要 schema 约束的演示用硅基流动(`.env.sf`,同一模型)。
- 环境变量统一 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`(embedding 用 `EMB_*`),放在 `agent-zero-lab/.env`。
- 不要把共享模块写进 scratchpad 里别人的目录;每个写手只在自己的子目录(如 `w216/agent-zero-lab/`)里放一份副本。


## 6. 怎么实跑

- 在自己的 scratchpad 里建一份 `agent-zero-lab` 来跑,**不要写用户的任何真实目录**(`~/Documents/agent-60-lab` 等)。需要 API key 时从 `~/Documents/agent-60-lab/.env` 复制一份到 scratchpad(DeepSeek,已充值);每天的实跑花费控制在 ¥1 以内,文中写出算式。**实跑只用 `deepseek-flash`,不准调 `deepseek-v4-pro` 或其他大模型**(2026-10-27 定);讲大小模型对比的天(路由、Advisor、蒸馏老师等)引用前面已有的实测结果,或给出读者可跑的代码并标「没实跑」。
- **安全红线**:凡是让模型执行命令、读写文件、操作浏览器的 Agent(coding agent、shell 工具、computer use 等),实跑时必须把它关在你自己的 scratchpad 子目录里(macOS `sandbox-exec` 限制读写范围,或工具层把路径限定在工作目录并拒绝 `..`/绝对路径),并且第一版就要有这个限制。**绝不能让它读到用户家目录、`~/Documents/nue`(公司代码)或任何真实仓库**,因为工具结果会发给第三方模型厂商。演示「没有沙箱会怎样」只用伪造的目录和假数据。
- 本机是 2019 款 Intel MacBook Pro,没有 GPU、没有 Docker、只有 JDK 8;需要这些的写明没实跑。本机 Postgres.app(5432,用户 minliu 无密码)可用,只能在自己新建的库里操作。
- 类型检查:可用 basedpyright standard 档检查 scratchpad 里的代码,读者用 Zed 会看到红线,文章里的代码要 0 报错。

## 7. 并行写作的约定

- 你只写分配给你的那几天,按顺序写;只新建自己的文件,不改别人的文件,不 git commit。
- 写某天前,先看 `src/content/blog/agent-zero/` 里前一两天是否已经写好:写好了就读它,保持代码、文件名、变量名、例子数据衔接;还没写好(在别的写手手里)就按大纲和旧课来源写,并在汇报里列出你假设了前面哪些文件和函数名。
- 写完跑 `cd ~/Documents/blog && python3 scripts/check-course.py --series=agent-zero`,只修自己文件报的问题(「明天预告」指向的下一天还没写时那条可忽略)。外链和视频自己逐个 curl 验证,不要跑全站 `--links`。
- 汇报:每篇文件名、汉字数、图/视频数、实跑花费、没实跑的部分、二手来源、建议拆天的地方。
