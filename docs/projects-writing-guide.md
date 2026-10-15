# 实战项目页 · 写作规范

站点新增独立栏目「实战项目」(`/projects/`),和按天的课程文章分开。每个项目一个 Markdown 文件:`src/content/projects/<slug>.md`。它是**项目说明书**(做什么、为什么、怎么分阶段做、怎么验收),不是逐日教程;读者照着它能自己开工,也能判断值不值得做。

## 读者

学完课程进阶篇(Day 61–110)的人:会写 Agent 循环、RAG、MCP、LangGraph、评测、部署。目标是资深 Agent 工程师 / AI 平台工程师 / 海外 FDE。站长本人:8 年前端 + 半年 Java 后端,人在中国大陆,电脑是 2019 款 13 寸 Intel MacBook Pro(无 GPU、内存紧),本地没装 Docker,每月学习预算约 $30–60。项目要标清楚哪些步骤本机做不了、要租什么、大概多少钱。

## frontmatter(字段名和类型严格按这个)

```yaml
---
title: 'Steward · 浏览器 Agent 与可靠性评测'   # 「项目名 · 中文副标题」
name: 'Steward'
tagline: '一句话,40 字以内,说清做的是什么'
summary: '列表卡片上的 2–3 句介绍,120 字以内'
order: 3                 # 列表排序,见下方编号
difficulty: 4            # 1–5,5 最难
level: '资深'             # 只能是 '中高级' | '资深' | '资深+'
duration: '6–8 周(业余时间)'
cost: '约 $20–50 API 费(2026-10 估算)'
gpu: false               # 需要租 GPU 才写 true
targets: ['Agent 平台工程师', '海外 FDE']   # 对准的岗位,2–3 个
stack: ['Python', 'Playwright', 'LangGraph']  # 4–8 个
recognition: '外部认可来源,一句话,如「SWE-bench 官方方法跑出的通过率 + 技术报告」'
depends: []              # 依赖的其他项目 slug,可空
status: 'spec'           # 现在都写 'spec';有逐日教程的写 'tutorial'
---
```

## 正文骨架(二级标题,顺序固定)

1. `## 这个项目是什么`:两三段,讲清楚问题、你做的东西、做完长什么样。
2. `## 为什么值得做`:招聘方会怎么看;对准什么岗位;和市面上已有的东西比,你做的点在哪。**只写查证过的事实**,不确定的说「我的判断」。
3. `## 要做出什么`:功能清单(必做 / 加分),再写「不做什么」。
4. `## 架构`:一张内联 SVG 架构图(和课程文章一样的写法:`<figure>` 包 `<svg viewBox>`,颜色用 `currentColor` 或中性灰,明暗模式都能看清,字号 ≥ 12),再加一两段文字说明关键设计取舍。
5. `## 分阶段计划`:按周的里程碑表(`| 周 | 目标 | 产出 | 怎么算完成 |`),一般 5–10 行。
6. `## 验收指标`:表格列出要测的指标、怎么测、目标值。**目标值只写方向或你能论证的门槛,不要编实测结果**;对比基线如果引用公开数字,必须写来源链接和查证日期。
7. `## 最终产出`:仓库、技术报告/文章、在线演示、视频、上游 PR 等,每项一句。
8. `## 难点和坑`:5–8 条具体的坑(具体到报错/现象/数字),自然段或短列表。
9. `## 面试里怎么讲`:按「问题 → 方案 → 数据 → 取舍」给一段示范讲法,再列 3 个面试官可能追问的问题和答题要点(用 `<details><summary>` 折叠答案,`<details>` 前后空行)。
10. `## 前置知识`:需要课程里哪几天的内容(写 Day 编号和主题即可,不用链接)。
11. `## 参考资料`:论文、官方文档、开源仓库、基准,8–15 条,每条一句说明用它干什么。

## 硬规则

- 语气按 `docs/course-writing-guide-agent.md` 第 3.0 节:像做过这事的工程师给朋友讲,禁用 AI 报告腔词句,少加粗,少破折号,正文以自然段为主。
- 长度:纯汉字 3,000–5,000(`python3 -c "import re,sys;print(len(re.findall(r'[一-鿿]',open(sys.argv[1]).read())))" FILE`)。
- **所有 URL 必须 curl 验证**(`curl -sIL -o /dev/null -w '%{http_code}' URL` 为 200;arXiv 用 abs 页)。论文的标题、作者、年份要和 arXiv 页面一致。开源仓库要确认还在维护(看最近提交日期)。基准的当前榜单数字如果引用,写查证日期。
- 价格(API、云 GPU)要查当前价格页,写查证日期;查不到就写算式让读者自己代入。
- 不编造任何运行结果、分数、star 数。
- 不引用、不暗示任何真实公司的内部代码或客户数据;需要业务数据就用课程里的虚构公司「云簿 CloudLedger」。
- 不要跑 `npm run build`,不要 git commit,只写自己负责的文件。

## 项目编号(order / slug,全站固定)

| order | slug | 名称 | 一句话 |
| --- | --- | --- | --- |
| 1 | agent-loupe | Agent Loupe | Agent 运行记录调试器(已有教程 Day 111–120) |
| 2 | billsleuth | BillSleuth | 计费争议调查 Agent(已有教程 Day 121–130) |
| 3 | steward | Steward | 浏览器 Agent + 可靠性评测:在自建的 SaaS 后台上完成多步任务,30–50 个任务的评测集,测成功率、步数、遇到弹窗/慢加载时的恢复 |
| 4 | mender | Mender | 从零写修 GitHub issue 的代码 Agent,按 SWE-bench 官方方法在 Verified 子集 50 题上跑分,公开通过率、单题成本、失败分析 |
| 5 | bastion | Bastion | 防提示注入的 Agent 防火墙:参考 CaMeL 的「规划模型 + 隔离模型 + 数据流/能力追踪」,在 AgentDojo 上测攻击成功率与任务完成率 |
| 6 | billbench | BillBench | 把 BillSleuth 扩成公开基准:500 场景分难度、私有测试集防污染、十几个模型跑分、排行榜网站、技术报告、开放提交 |
| 7 | anchor | Anchor | 持久化 Agent 运行时:每步检查点、崩溃恢复、工具副作用只执行一次、人工审批挂起数天、多机调度,用故障注入证明可靠 |
| 8 | whetstone | Whetstone | 会自我改进的 Agent:参考 DSPy/GEPA,用评测失败案例自动改写提示词和工具描述,留出集 + 统计检验证明不是过拟合 |
| 9 | hippo | Hippo | 长期记忆系统:写入/合并/遗忘/检索,在 LongMemEval、LoCoMo 上和 Mem0、Zep 等对比 |
| 10 | ledgergym | LedgerGym | 把 BillSleuth 场景包装成 RL 环境,用 GRPO 训练 3B–7B 开源模型做多轮工具调用,对比训练前后与大模型(要租 GPU,最难) |

项目之间可以引用(例如 Bastion 可以拿 Steward 当被攻击对象,LedgerGym 和 BillBench 都基于 BillSleuth),在 `depends` 和正文里写清楚。
